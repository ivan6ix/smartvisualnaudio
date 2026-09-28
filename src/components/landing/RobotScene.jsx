import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import styles from "./Landing.module.css";

function disposeTree(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    list.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => { if (value?.isTexture) textures.add(value); });
    });
  });
  textures.forEach((texture) => { texture.source?.data?.close?.(); texture.dispose(); });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

// Match the original display's UV layout so the animated eyes stay on its curved surface.
function createEyes() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  function draw(x, y, blink = 1) {
    context.fillStyle = "#071515";
    context.fillRect(0, 0, 512, 512);
    [144, 366].forEach((center) => {
      const eyeX = center + x * 26;
      const eyeY = 250 + y * 18;
      context.shadowColor = "#3bffdc";
      context.shadowBlur = 16;
      context.fillStyle = "#65efd9";
      context.beginPath();
      context.ellipse(eyeX, eyeY, 39, Math.max(4, 51 * blink), 0, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      if (blink > .5) {
        context.fillStyle = "#d9fff5";
        context.beginPath();
        context.ellipse(eyeX - 8, eyeY - 15, 8, 11 * blink, 0, 0, Math.PI * 2);
        context.fill();
      }
    });
    texture.needsUpdate = true;
  }
  draw(0, 0);
  return { texture, draw };
}

export default function RobotScene({ heroRef, theme, paused }) {
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const stateRef = useRef({ theme, paused });

  useEffect(() => {
    stateRef.current = { theme, paused };
    runtimeRef.current?.update();
  }, [theme, paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    let disposed = false;
    let failed = false;
    let visible = true;
    let loaded = false;
    let model;
    let head;
    let baseHeadQuaternion;
    let eyes;
    let renderer;
    let lastTime = 0;
    let elapsed = 0;
    let lastEyeUpdate = 0;
    const pointer = { x: 0, y: 0, active: false };
    const gaze = { x: 0, y: 0 };
    const coarse = window.matchMedia("(pointer: coarse)");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1, .1, 40);
    camera.position.set(.25, 1.8, 7.6);
    camera.lookAt(0, 1.55, 0);
    const rig = new THREE.Group();
    scene.add(rig);
    const ambient = new THREE.HemisphereLight(0xf5fff5, 0x486052, 2.7);
    const key = new THREE.DirectionalLight(0xfffaf0, 4.2);
    key.position.set(-3, 5, 5);
    const fill = new THREE.DirectionalLight(0xb1eee0, 1.4);
    fill.position.set(4, 3, 1);
    const rim = new THREE.DirectionalLight(0xebfff4, 2);
    rim.position.set(1, 4, -4);
    scene.add(ambient, key, fill, rim);
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext("2d");
    const gradient = shadowContext.createRadialGradient(64, 64, 5, 64, 64, 62);
    gradient.addColorStop(0, "rgba(6,25,19,.27)");
    gradient.addColorStop(1, "rgba(6,25,19,0)");
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 2.5), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -.015;
    scene.add(shadow);

    function fail() {
      failed = true;
      canvas.dataset.ready = "false";
      renderer?.setAnimationLoop(null);
    }

    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
    } catch {
      disposeTree(scene);
      return undefined;
    }

    function render() { if (!disposed && !failed) renderer.render(scene, camera); }
    function resize() {
      const { width, height } = canvas.parentElement.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    }

    function frame(time) {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
      lastTime = time;
      elapsed += dt;
      const entrance = Math.min(elapsed / 1.2, 1);
      rig.scale.setScalar(.12 + .88 * (1 - Math.pow(1 - entrance, 3)));
      const targetX = pointer.active ? pointer.x : coarse.matches ? Math.sin(elapsed * .5) * .15 : 0;
      const targetY = pointer.active ? pointer.y : 0;
      gaze.x = THREE.MathUtils.damp(gaze.x, targetX, 5, dt);
      gaze.y = THREE.MathUtils.damp(gaze.y, targetY, 5, dt);
      if (head) {
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(gaze.y * .105, gaze.x * .175, 0, "YXZ"));
        head.quaternion.copy(rotation).multiply(baseHeadQuaternion);
      }
      rig.position.y = Math.sin(elapsed * 1.4) * .014;
      rig.rotation.z = Math.sin(elapsed * .7) * .008;
      if (eyes && time - lastEyeUpdate > 32) {
        const blinkTime = elapsed % 6.5;
        const blink = blinkTime > 6.22 ? Math.max(.12, Math.abs(blinkTime - 6.36) / .14) : 1;
        eyes.draw(gaze.x, gaze.y, blink);
        lastEyeUpdate = time;
      }
      render();
    }

    function update() {
      const dark = stateRef.current.theme === "dark";
      ambient.intensity = dark ? 2.8 : 2.7;
      fill.intensity = dark ? 2 : 1.4;
      renderer.toneMappingExposure = dark ? 1.15 : 1.1;
      if (!loaded || disposed || failed) return;
      if (stateRef.current.paused) { rig.scale.setScalar(1); elapsed = Math.max(elapsed, 1.2); }
      const animate = visible && !document.hidden && !stateRef.current.paused;
      renderer.setAnimationLoop(animate ? frame : null);
      lastTime = 0;
      render();
    }

    function move(event) {
      if (stateRef.current.paused || event.pointerType === "touch") return;
      pointer.x = THREE.MathUtils.clamp((event.clientX - window.innerWidth / 2) / (window.innerWidth / 2), -1, 1);
      pointer.y = THREE.MathUtils.clamp((event.clientY - window.innerHeight * .38) / (window.innerHeight / 2), -1, 1);
      pointer.active = true;
    }
    function leave() { pointer.active = false; pointer.x = pointer.y = 0; }
    function contextLost(event) { event.preventDefault(); fail(); }
    function contextRestored() { failed = false; canvas.dataset.ready = String(loaded); update(); }

    const resizeObserver = new window.ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement);
    const intersectionObserver = new window.IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    intersectionObserver.observe(canvas);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", update);
    canvas.addEventListener("webglcontextlost", contextLost);
    canvas.addEventListener("webglcontextrestored", contextRestored);
    runtimeRef.current = { update };
    resize();

    new GLTFLoader().load("/landing/ai_robot.glb", (gltf) => {
      if (disposed) { disposeTree(gltf.scene); return; }
      try {
        model = gltf.scene;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = 3.35 / size.y;
        model.scale.multiplyScalar(scale);
        model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
        rig.add(model);
        rig.rotation.y = -.12;
        head = model.getObjectByName("Head");
        baseHeadQuaternion = head?.quaternion.clone();
        const eyeMesh = model.getObjectByName("Head_Eyes_0");
        if (eyeMesh) {
          eyes = createEyes();
          const oldMaterial = eyeMesh.material;
          const originalTextures = new Set([oldMaterial.map, oldMaterial.emissiveMap]);
          originalTextures.forEach((texture) => { texture?.source?.data?.close?.(); texture?.dispose(); });
          oldMaterial.dispose();
          eyeMesh.material = new THREE.MeshBasicMaterial({ map: eyes.texture, side: THREE.DoubleSide, toneMapped: false });
        }
        model.traverse((object) => {
          if (object.isMesh && object !== eyeMesh) {
            if (object.material.name === "EyeBorder") { object.material.color.set("#2eb59e"); object.material.roughness = .5; }
            if (object.material.name === "Head" || object.material.name === "chestMat") { object.material.color.set("#d6e2de"); object.material.roughness = .34; }
          }
        });
        loaded = true;
        rig.scale.setScalar(stateRef.current.paused ? 1 : .12);
        resize();
        update();
        canvas.dataset.ready = String(!failed);
      } catch { fail(); }
    }, undefined, fail);

    return () => {
      disposed = true;
      runtimeRef.current = null;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", update);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      disposeTree(scene);
      renderer.dispose();
      canvas.dataset.ready = "false";
    };
  }, [heroRef]);

  return <canvas ref={canvasRef} className={styles.robotCanvas} aria-hidden="true" data-ready="false" />;
}
