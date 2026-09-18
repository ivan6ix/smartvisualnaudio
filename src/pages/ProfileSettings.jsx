import { useEffect, useRef, useState } from "react";
import { FiTrash2, FiUpload } from "react-icons/fi";
import { toast } from "sonner";
import ProfileAvatar from "../components/ProfileAvatar";
import SettingsSections from "../components/SettingsSections";
import { Button, Card, PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

const CROP_PREVIEW_SIZE = 280;
const AVATAR_OUTPUT_SIZE = 512;

function getCropLayout(imageMeta, crop, size) {
  const baseScale = Math.max(size / imageMeta.width, size / imageMeta.height);
  const scale = baseScale * crop.zoom;
  const width = imageMeta.width * scale;
  const height = imageMeta.height * scale;
  return {
    width,
    height,
    x: (size - width) / 2 + crop.x * (size / CROP_PREVIEW_SIZE),
    y: (size - height) / 2 + crop.y * (size / CROP_PREVIEW_SIZE),
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function cropAvatar(imageSrc, crop, imageMeta) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;

  const layout = getCropLayout(imageMeta, crop, AVATAR_OUTPUT_SIZE);
  context.drawImage(image, layout.x, layout.y, layout.width, layout.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 0.92);
  });
}

export default function ProfileSettings() {
  const { user, updateCachedUser } = useAuth();
  const fileInputRef = useRef(null);
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");
  const [cropImage, setCropImage] = useState("");
  const [cropImageMeta, setCropImageMeta] = useState(null);
  const [crop, setCrop] = useState({ zoom: 1, x: 0, y: 0 });
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);

  useEffect(() => {
    setAvatarUrl(user?.avatarUrl || "");
  }, [user?.avatarUrl]);

  async function chooseAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Profile picture must be 5MB or smaller.");
      return;
    }

    const imageSrc = await readImageFile(file);
    const image = await loadImage(imageSrc);
    setCropImage(imageSrc);
    setCropImageMeta({ width: image.naturalWidth, height: image.naturalHeight });
    setCrop({ zoom: 1, x: 0, y: 0 });
  }

  async function saveAvatar() {
    if (!cropImage || !cropImageMeta || !user?.id) return;
    setSavingAvatar(true);

    try {
      const blob = await cropAvatar(cropImage, crop, cropImageMeta);
      if (!blob) throw new Error("Unable to crop image.");

      let nextAvatarUrl = await blobToDataUrl(blob);
      if (hasSupabaseConfig) {
        const path = `${user.id}/avatar.png`;
        const { error: uploadError } = await supabase.storage
          .from("profile-pictures")
          .upload(path, blob, { contentType: "image/png", upsert: true });
        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage.from("profile-pictures").getPublicUrl(path);
        nextAvatarUrl = `${publicData.publicUrl}?v=${Date.now()}`;

        const { error: profileError } = await supabase
          .from("profiles")
          .update({ avatar_url: nextAvatarUrl })
          .eq("id", user.id);
        if (profileError) throw profileError;
      }

      setAvatarUrl(nextAvatarUrl);
      updateCachedUser?.({ avatarUrl: nextAvatarUrl });
      setCropImage("");
      setCropImageMeta(null);
      toast.success("Profile picture updated");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingAvatar(false);
    }
  }

  async function removeAvatar() {
    if (!user?.id || removingAvatar) return;
    setRemovingAvatar(true);

    try {
      if (hasSupabaseConfig) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ avatar_url: null })
          .eq("id", user.id);
        if (profileError) throw profileError;

        const { error: storageError } = await supabase.storage
          .from("profile-pictures")
          .remove([`${user.id}/avatar.png`]);
        if (storageError && import.meta.env.DEV) window.console.warn("Profile photo storage delete failed", storageError);
      }

      setAvatarUrl("");
      updateCachedUser?.({ avatarUrl: "" });
      setRemoveConfirmOpen(false);
      toast.success("Profile photo removed successfully.");
    } catch (error) {
      if (import.meta.env.DEV) window.console.error("Profile photo removal failed", error);
      toast.error("Unable to remove profile photo. Please try again.");
    } finally {
      setRemovingAvatar(false);
    }
  }

  return (
    <section className="admin-dashboard-page admin-section-page settings-page">
      <PageHeader title="Profile Settings" subtitle="Manage profile information, appearance, and notification preferences." />
      <div className="dashboard-grid">
        <Card className="admin-panel settings-surface-card profile-settings-card">
          <div className="profile-picture-editor">
            <ProfileAvatar className="profile-avatar-large" name={user?.fullName} src={avatarUrl} />
            <div>
              <h2>Profile Picture</h2>
              <p>Upload a photo and crop it inside the circle.</p>
              <div className="profile-picture-actions">
                <button className="profile-picture-upload" onClick={() => fileInputRef.current?.click()} type="button">
                  <FiUpload /> Upload Picture
                </button>
                {avatarUrl ? (
                  <button className="profile-picture-remove" disabled={savingAvatar || removingAvatar} onClick={() => setRemoveConfirmOpen(true)} type="button">
                    <FiTrash2 /> Remove Photo
                  </button>
                ) : null}
              </div>
              <input accept="image/*" hidden onChange={chooseAvatar} ref={fileInputRef} type="file" />
            </div>
          </div>
        </Card>
        <Card className="admin-panel settings-surface-card">
          <h2>Profile Information</h2>
          <div className="info-list">
            <span>Full Name <strong>{user?.fullName || "-"}</strong></span>
            <span>Email <strong>{user?.email || "-"}</strong></span>
            <span>Role <strong>{user?.role || "-"}</strong></span>
            <span>School ID <strong>{user?.schoolId || user?.studentNumber || "-"}</strong></span>
          </div>
        </Card>
      </div>
      <SettingsSections />

      {cropImage && cropImageMeta ? (
        <div className="avatar-crop-backdrop" onClick={() => { setCropImage(""); setCropImageMeta(null); }} role="presentation">
          <section className="avatar-crop-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <div>
                <h2>Adjust Profile Picture</h2>
                <p>Position your photo inside the circle.</p>
              </div>
              <button aria-label="Close crop editor" onClick={() => { setCropImage(""); setCropImageMeta(null); }} type="button">x</button>
            </header>
            <div className="avatar-crop-preview">
              <img
                alt="Profile crop preview"
                src={cropImage}
                style={(() => {
                  const layout = getCropLayout(cropImageMeta, crop, CROP_PREVIEW_SIZE);
                  return {
                    height: `${layout.height}px`,
                    left: `${layout.x}px`,
                    top: `${layout.y}px`,
                    width: `${layout.width}px`,
                  };
                })()}
              />
            </div>
            <div className="avatar-crop-controls">
              <label>
                <span>Zoom</span>
                <input max="3" min="1" onChange={(event) => setCrop((current) => ({ ...current, zoom: Number(event.target.value) }))} step="0.05" type="range" value={crop.zoom} />
              </label>
              <label>
                <span>Horizontal</span>
                <input max="100" min="-100" onChange={(event) => setCrop((current) => ({ ...current, x: Number(event.target.value) }))} type="range" value={crop.x} />
              </label>
              <label>
                <span>Vertical</span>
                <input max="100" min="-100" onChange={(event) => setCrop((current) => ({ ...current, y: Number(event.target.value) }))} type="range" value={crop.y} />
              </label>
            </div>
            <Button disabled={savingAvatar} onClick={saveAvatar}>{savingAvatar ? "Saving..." : "Save Picture"}</Button>
          </section>
        </div>
      ) : null}

      {removeConfirmOpen ? (
        <div className="avatar-crop-backdrop" onClick={() => removingAvatar ? null : setRemoveConfirmOpen(false)} role="presentation">
          <section className="avatar-crop-modal profile-remove-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="remove-profile-photo-title">
            <header>
              <div>
                <h2 id="remove-profile-photo-title">Remove Profile Photo?</h2>
                <p>Are you sure you want to remove your current profile photo? Your account will use the default profile avatar instead.</p>
              </div>
            </header>
            <div className="profile-remove-actions">
              <button disabled={removingAvatar} onClick={() => setRemoveConfirmOpen(false)} type="button">Cancel</button>
              <button className="danger" disabled={removingAvatar} onClick={removeAvatar} type="button">
                <FiTrash2 /> {removingAvatar ? "Removing..." : "Remove Photo"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
