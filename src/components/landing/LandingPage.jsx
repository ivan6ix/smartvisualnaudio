import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, BookOpen, Check, CheckCheck, ChevronDown, CircleHelp, ClipboardCheck, FileCheck2, GraduationCap, Menu, MessageSquare, Moon, Pause, Play, Radar, RotateCcw, ScanFace, ShieldCheck, SlidersHorizontal, Sun, X } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "../../context/ThemeContext";
import { faqs, roles, steps } from "./content";
import SignInDialog from "./SignInDialog";
import Brand from "./Brand";
import styles from "./Landing.module.css";

const RobotScene = lazy(() => import("./RobotScene"));
const navigation = [["Monitoring", "monitoring"], ["Workflow", "workflow"], ["For everyone", "roles"], ["FAQs", "faq"]];
const roleIcons = [SlidersHorizontal, BookOpen, ClipboardCheck, GraduationCap, ShieldCheck];

class RobotBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function Waveform({ small = false }) {
  return <svg className={styles.waveform} viewBox="0 0 300 90" fill="none" aria-hidden="true">{Array.from({ length: small ? 25 : 45 }, (_, i) => {
    const count = small ? 25 : 45;
    const height = 9 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31)) * 62;
    return <path key={i} d={`M${6 + i * (288 / count)} ${45 - height / 2}v${height}`} stroke="currentColor" strokeWidth={small ? 4 : 3} strokeLinecap="round" style={{ animationDelay: `${i * -0.17}s` }} />;
  })}</svg>;
}

function Goo() {
  return <div className={styles.goo} aria-hidden="true"><span /><span /><span /></div>;
}

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const [signInOpen, setSignInOpen] = useState(searchParams.get("confirmed") === "1" || searchParams.get("signin") === "1");
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState(1);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const pageRef = useRef(null);
  const heroRef = useRef(null);
  const tabRefs = useRef([]);
  const menuButtonRef = useRef(null);
  const confirmationShown = useRef(false);
  const tiltFrame = useRef(0);
  const tiltedElement = useRef(null);
  const motionPaused = paused || reducedMotion || signInOpen;
  const RoleIcon = roleIcons[role];

  useEffect(() => {
    if (motionPaused && tiltedElement.current) {
      tiltedElement.current.style.setProperty("--tilt-x", "0deg");
      tiltedElement.current.style.setProperty("--tilt-y", "0deg");
    }
    return () => window.cancelAnimationFrame(tiltFrame.current);
  }, [motionPaused]);

  function tiltCard(event) {
    if (motionPaused || event.pointerType === "touch") return;
    const element = event.currentTarget;
    const bounds = element.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    window.cancelAnimationFrame(tiltFrame.current);
    tiltedElement.current = element;
    tiltFrame.current = window.requestAnimationFrame(() => {
      element.style.setProperty("--tilt-x", `${x * 7}deg`);
      element.style.setProperty("--tilt-y", `${-y * 7}deg`);
      element.style.setProperty("--shine-x", `${(x + .5) * 100}%`);
      element.style.setProperty("--shine-y", `${(y + .5) * 100}%`);
    });
  }

  function resetTilt(event) {
    window.cancelAnimationFrame(tiltFrame.current);
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
    tiltedElement.current = null;
  }

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Smart Proctoring — Confidence in every exam";
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (searchParams.get("confirmed") === "1" && !confirmationShown.current) {
      confirmationShown.current = true;
      setSignInOpen(true);
      toast.success("Email confirmed. You can now log in.");
    }
  }, [searchParams]);

  useEffect(() => {
    const page = pageRef.current;
    const observer = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.dataset.revealed = "true"; observer.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    page.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
    const animationObserver = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => { entry.target.dataset.inView = String(entry.isIntersecting); });
    });
    page.querySelectorAll("[data-animated]").forEach((element) => animationObserver.observe(element));
    const updateVisibility = () => { page.dataset.hidden = String(document.hidden); };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { observer.disconnect(); animationObserver.disconnect(); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);

  function openSignIn() { setMenuOpen(false); setSignInOpen(true); }

  function scrollToSection(event, id) {
    event.preventDefault();
    setMenuOpen(false);
    const section = document.getElementById(id);
    section?.scrollIntoView({ behavior: motionPaused ? "instant" : "smooth", block: "start" });
    section?.focus({ preventScroll: true });
  }

  function onRoleKey(event) {
    let next;
    if (event.key === "ArrowRight") next = (role + 1) % roles.length;
    if (event.key === "ArrowLeft") next = (role + roles.length - 1) % roles.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = roles.length - 1;
    if (next !== undefined) { event.preventDefault(); setRole(next); tabRefs.current[next]?.focus(); }
  }

  return (
    <div className={styles.page} data-theme={theme} data-paused={motionPaused} ref={pageRef}>
      <svg className={styles.filterDefinitions} aria-hidden="true"><defs><filter id="landing-goo"><feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur" /><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -7" /></filter></defs></svg>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <a href="#main-content" aria-label="Smart Proctoring home" onClick={(event) => scrollToSection(event, "main-content")}><Brand /></a>
        <nav className={styles.desktopNav} aria-label="Main navigation">{navigation.map(([text, id]) => <a key={id} href={`#${id}`} onClick={(event) => scrollToSection(event, id)}>{text}</a>)}</nav>
        <div className={styles.headerActions}>
          <button type="button" className={styles.iconButton} onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className={styles.headerSignIn} type="button" onClick={openSignIn}>Sign in <ArrowUpRight size={16} /></button>
          <button ref={menuButtonRef} className={`${styles.iconButton} ${styles.menuButton}`} type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="landing-mobile-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button>
        </div>
        {menuOpen && <nav id="landing-mobile-nav" className={styles.mobileNav} aria-label="Mobile navigation" onKeyDown={(event) => { if (event.key === "Escape") { setMenuOpen(false); menuButtonRef.current?.focus(); } }}>{navigation.map(([text, id]) => <a key={id} href={`#${id}`} onClick={(event) => scrollToSection(event, id)}>{text}<ArrowUpRight size={17} /></a>)}</nav>}
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} ref={heroRef} aria-labelledby="hero-heading">
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}><span /> BUILT FOR FAIRER ASSESSMENTS</div>
            <h1 id="hero-heading">Confidence<br />in every<br /><span>exam.</span><span className={styles.headingSpark} aria-hidden="true">✳</span></h1>
            <p className={styles.heroDescription}>Bring audio and visual monitoring, flexible assessments, and evidence-based review into one connected examination platform.</p>
            <div className={styles.heroActions}><button type="button" className={styles.primaryButton} onClick={openSignIn}>Sign in to your workspace <ArrowUpRight size={19} /></button><a className={styles.textLink} href="#monitoring" onClick={(event) => scrollToSection(event, "monitoring")}>Explore monitoring <ArrowDown size={17} /></a></div>
            <p className={styles.heroFootnote}><ShieldCheck size={16} /> Thoughtfully built for your academic community.</p>
          </div>
          <div className={styles.heroVisual}>
            <div className={styles.orbit} aria-hidden="true"><span /><span /><span /></div>
            <div className={styles.sceneFrame}>
              <img className={styles.robotPoster} src="/landing/robot-poster.png" alt="A friendly white and teal robot representing Smart Proctoring" width="900" height="1000" />
              <RobotBoundary><Suspense fallback={null}><RobotScene heroRef={heroRef} theme={theme} paused={motionPaused} /></Suspense></RobotBoundary>
            </div>
            <div className={`${styles.floatingCard} ${styles.visualCard}`} data-animated><span className={styles.smallIcon}><ScanFace size={21} /></span><div><span className={styles.cardOverline}>VISUAL MONITORING <em>DEMO</em></span><strong>A little more awareness.</strong><span className={styles.miniStatus}><i /> Face presence</span></div></div>
            <div className={`${styles.floatingCard} ${styles.audioCard}`} data-animated><div className={styles.audioCardHeading}><AudioLines size={16} /><span>Audio activity</span><em>DEMO</em></div><Waveform small /><span className={styles.audioCaption}>Hear the bigger picture.</span></div>
            <div className={styles.robotCaption}><span className={styles.captionLine} /><span>YOUR EXAM INTEGRITY COMPANION</span></div>
            <button className={styles.motionButton} type="button" onClick={() => setPaused(!paused)} disabled={reducedMotion} aria-pressed={motionPaused} aria-label={reducedMotion ? "Animations disabled by reduced motion preference" : paused ? "Resume animations" : "Pause animations"}>{motionPaused ? <Play size={12} /> : <Pause size={12} />}<span>{reducedMotion ? "Reduced motion" : paused ? "Motion paused" : "Pause motion"}</span></button>
          </div>
        </section>

        <div className={styles.roleStrip} data-animated><span>ONE PLATFORM.<br /><strong>YOUR ENTIRE COMMUNITY.</strong></span><div className={styles.tickerViewport}><div className={styles.tickerTrack}>{[0, 1].map((copy) => <div className={styles.tickerGroup} key={copy} aria-hidden={copy === 1 ? "true" : undefined}>{roles.map(({ name }, i) => { const Icon = roleIcons[i]; return <span key={name}><Icon size={19} strokeWidth={1.5} />{name}</span>; })}</div>)}</div></div></div>

        <section id="monitoring" className={styles.section} tabIndex={-1} aria-labelledby="monitoring-heading">
          <div className={styles.sectionHeader} data-reveal><div><p className={styles.eyebrow}>01 / AWARENESS, WITH PURPOSE</p><h2 id="monitoring-heading">See more. Hear more.<br /><span>Understand more.</span></h2></div><p>Bring the moments that matter into focus. Audio and visual signals give educators context for a more informed review.</p></div>
          <div className={styles.monitorGrid}>
            <article className={`${styles.featureCard} ${styles.scanCard} ${styles.depthCard}`} data-reveal="left" data-animated onPointerMove={tiltCard} onPointerLeave={resetTilt}><Goo />
              <div className={styles.cardTop}><span><ScanFace size={17} /> VISUAL AWARENESS</span><span className={styles.demoPill}>DEMO</span></div>
              <div className={styles.scanIllustration} aria-hidden="true"><svg viewBox="0 0 460 240" fill="none"><path d="M80 45h-20v30m340-30h-20m20 0v30M60 165v30h20m300 0h20v-30" stroke="currentColor" strokeWidth="2" /><ellipse cx="230" cy="113" rx="46" ry="54" stroke="currentColor" strokeWidth="1.5" /><path d="M152 211c8-54 40-62 78-62s70 8 78 62M198 109h64M230 67v87" stroke="currentColor" strokeWidth="1" strokeDasharray="3 5" /><circle cx="212" cy="107" r="4" fill="currentColor" /><circle cx="248" cy="107" r="4" fill="currentColor" /><path d="M215 132q15 10 30 0" stroke="currentColor" strokeWidth="2" /><path className={styles.scanLine} d="M63 120h334" stroke="currentColor" strokeWidth="1.5" /><circle cx="60" cy="120" r="3" fill="currentColor" /><circle cx="400" cy="120" r="3" fill="currentColor" /></svg><span className={styles.scanTag}><span /> FACE PRESENCE & ATTENTION</span></div>
              <h3>A clearer view of the exam.</h3><p>Surface face absence, multiple faces, and looking-away events for review. More context, without losing the bigger picture.</p>
            </article>
            <article className={`${styles.featureCard} ${styles.waveCard} ${styles.depthCard}`} data-reveal="right" data-animated onPointerMove={tiltCard} onPointerLeave={resetTilt}><Goo />
              <div className={styles.cardTop}><span><AudioLines size={17} /> AUDIO AWARENESS</span><span className={styles.demoPill}>DEMO</span></div><div className={styles.waveIllustration}><Waveform /><span>LISTENING FOR THE MOMENTS THAT MATTER</span></div><h3>Another layer of awareness.</h3><p>Flag background voices and sustained audio activity alongside visual events, according to your exam settings.</p>
            </article>
            <article className={`${styles.featureCard} ${styles.compactFeature}`} data-reveal><span className={styles.featureIcon}><Radar size={25} /></span><div><h3>Start with the surroundings.</h3><p>Pre-exam environment scans help identify other people or potentially prohibited objects before an attempt begins.</p></div><span className={styles.featureNumber}>03</span></article>
            <article className={`${styles.featureCard} ${styles.compactFeature}`} data-reveal><span className={styles.featureIcon}><FileCheck2 size={25} /></span><div><h3>Keep the examination in focus.</h3><p>Record tab switches, fullscreen exits, and configured violations, with evidence available for authorized review.</p></div><span className={styles.featureNumber}>04</span></article>
          </div>
          <p className={styles.sectionNote}><CircleHelp size={15} /> Monitoring supports review. A flagged event is context—not a conclusion.</p>
        </section>

        <section id="workflow" className={`${styles.section} ${styles.workflowSection}`} tabIndex={-1} aria-labelledby="workflow-heading">
          <div className={styles.sectionHeader} data-reveal><div><p className={styles.eyebrow}>02 / CONNECTED FROM THE START</p><h2 id="workflow-heading">A considered workflow.<br /><span>From question to insight.</span></h2></div><p>Less jumping between tools.<br />More room for what matters: the assessment.</p></div>
          <div className={styles.steps} data-animated>{steps.map((step, index) => <article data-reveal style={{ "--delay": `${index * 110}ms`, "--step-delay": `${index * 3}s` }} key={step.title}><div className={styles.stepNumber}><span>0{index + 1}</span>{index < 3 && <ArrowRight size={19} />}</div><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
        </section>

        <section id="roles" className={styles.section} tabIndex={-1} aria-labelledby="roles-heading">
          <div className={styles.centerHeading} data-reveal><p className={styles.eyebrow}>03 / DIFFERENT ROLES. SHARED PURPOSE.</p><h2 id="roles-heading">Built around <span>your people.</span></h2><p>The right tools for every role. A connected experience for everyone.</p></div>
          <div className={styles.roleTabs} role="tablist" aria-label="Platform roles">{roles.map((item, i) => <button key={item.name} ref={(element) => { tabRefs.current[i] = element; }} id={`role-tab-${i}`} role="tab" type="button" aria-selected={role === i} aria-controls={`role-panel-${i}`} tabIndex={role === i ? 0 : -1} onClick={() => setRole(i)} onKeyDown={onRoleKey}>{item.name}</button>)}</div>
          <div className={`${styles.rolePanel} ${styles.depthCard}`} role="tabpanel" id={`role-panel-${role}`} aria-labelledby={`role-tab-${role}`} tabIndex={0} data-reveal="zoom" data-animated onPointerMove={tiltCard} onPointerLeave={resetTilt}><Goo />
            <div key={role} className={styles.roleCopy}><span className={styles.roleLabel}><RoleIcon size={18} /> FOR THE {roles[role].name.toUpperCase()}</span><h3>{roles[role].title}</h3><p>{roles[role].description}</p><ul>{roles[role].features.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul><button type="button" className={styles.textLink} onClick={openSignIn}>Enter your workspace <ArrowUpRight size={17} /></button></div>
            <div className={styles.workspacePreview} aria-label={`Illustrative ${roles[role].name} workspace`}><div className={styles.previewToolbar}><span><i /><i /><i /></span><small>WORKSPACE PREVIEW · DEMO</small></div><div className={styles.previewContent}><span className={styles.previewGreeting}>Everything in its place.</span><h4>{roles[role].name} workspace <RoleIcon size={23} /></h4>{roles[role].preview.map((text, i) => <div className={styles.previewRow} key={text}><span className={styles.previewRowIcon}>{i === 0 ? <BookOpen size={18} /> : i === 1 ? <CheckCheck size={18} /> : <ClipboardCheck size={18} />}</span><span>{text}<span className={styles.previewLine} /></span><ArrowUpRight size={16} /></div>)}<div className={styles.previewFooter}><span /> One connected examination experience</div></div></div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.beyondSection}`} aria-labelledby="beyond-heading"><div className={styles.sectionHeader} data-reveal><div><p className={styles.eyebrow}>04 / THE DETAILS MAKE THE DIFFERENCE</p><h2 id="beyond-heading">Thoughtful tools.<br /><span>Beyond the exam.</span></h2></div><p>Designed for the real work around every assessment, not just the time spent taking it.</p></div><div className={styles.beyondGrid}>{[
          [SlidersHorizontal, "Assess your way.", "Flexible question types, file uploads, partial-match scoring, and manual grading for subjective answers."],
          [ClipboardCheck, "Progress, made visible.", "Detailed results, attempt histories, highest-score computation, and question-by-question grading."],
          [RotateCcw, "Room for the unexpected.", "Controlled pause and recovery during interruptions, while preserving examination timers and attempt rules."],
          [MessageSquare, "Keep everyone connected.", "Course enrollment, notifications, and messaging keep your academic community on the same page."],
        ].map(([Icon, title, text], i) => <article key={title} data-reveal style={{ "--delay": `${i * 70}ms` }}><Icon size={26} strokeWidth={1.5} /><h3>{title}</h3><p>{text}</p></article>)}</div></section>

        <section id="faq" className={`${styles.section} ${styles.faqSection}`} tabIndex={-1} aria-labelledby="faq-heading"><div data-reveal><p className={styles.eyebrow}>A LITTLE MORE CLARITY</p><h2 id="faq-heading">Good questions.<br /><span>Clear answers.</span></h2><p>Here’s what to know before<br />your next examination.</p></div><div className={styles.faqList}>{faqs.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown size={19} /></summary><p>{item.answer}</p></details>)}</div></section>

        <section className={styles.closing} aria-labelledby="closing-heading" data-reveal="zoom" data-animated><div className={styles.closingDecoration} aria-hidden="true">✳</div><p className={styles.eyebrow}>A BETTER EXAM EXPERIENCE STARTS HERE</p><h2 id="closing-heading">Ready for your<br />next exam?</h2><p>Your people. Your assessments. One connected platform.</p><div><button type="button" className={styles.primaryButton} onClick={openSignIn}>Sign in <ArrowUpRight size={19} /></button><Link className={styles.textLink} to="/register">Create account <ArrowUpRight size={18} /></Link></div></section>
      </main>

      <footer className={styles.footer}><div><Brand /><p>Smart Proctoring Through<br />Audio & Visual Monitoring</p></div><div className={styles.footerRight}><nav aria-label="Policies"><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms of Use</Link><Link to="/storage">Cookies & Storage</Link></nav><p>Built for learning. Designed for confidence.</p></div></footer>
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
