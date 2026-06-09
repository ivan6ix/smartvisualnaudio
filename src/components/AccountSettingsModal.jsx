import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { FiUpload, FiX } from "react-icons/fi";
import { toast } from "sonner";
import { Button, Card, Field } from "./ui";
import ProfileAvatar from "./ProfileAvatar";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function cropAvatar(imageSrc, crop) {
  const image = await loadImage(imageSrc);
  const size = 512;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = size;
  canvas.height = size;

  const baseScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const scale = baseScale * crop.zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const overflowX = Math.max(0, width - size);
  const overflowY = Math.max(0, height - size);
  const x = (size - width) / 2 + (crop.x / 100) * (overflowX / 2);
  const y = (size - height) / 2 + (crop.y / 100) * (overflowY / 2);

  context.drawImage(image, x, y, width, height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 0.92);
  });
}

export default function AccountSettingsModal({ mode, onClose }) {
  const { user, updateCachedUser } = useAuth();
  const { register, handleSubmit, reset, watch, formState: { isSubmitting } } = useForm();
  const fileInputRef = useRef(null);
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");
  const [cropImage, setCropImage] = useState("");
  const [crop, setCrop] = useState({ zoom: 1, x: 0, y: 0 });
  const [savingAvatar, setSavingAvatar] = useState(false);
  const isSecurity = mode === "security";
  const title = isSecurity ? "Security & Privacy" : "Profile Settings";

  async function updatePassword(values) {
    if (values.newPassword !== values.confirmPassword) {
      toast.error("New password and confirm password do not match");
      return;
    }

    if (hasSupabaseConfig) {
      const { error } = await supabase.auth.updateUser({ password: values.newPassword });
      if (error) {
        toast.error(error.message);
        return;
      }
    }

    toast.success("Password updated");
    reset();
  }

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
    setCropImage(imageSrc);
    setCrop({ zoom: 1, x: 0, y: 0 });
  }

  async function saveAvatar() {
    if (!cropImage || !user?.id) return;
    setSavingAvatar(true);

    try {
      const blob = await cropAvatar(cropImage, crop);
      if (!blob) throw new Error("Unable to crop image.");

      let nextAvatarUrl = cropImage;
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
      toast.success("Profile picture updated");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingAvatar(false);
    }
  }

  return (
    <div className="settings-modal-backdrop" onClick={onClose} role="presentation">
      <section className="settings-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="settings-modal-header">
          <div>
            <h2>{title}</h2>
            <p>{isSecurity ? "Manage password changes for your account." : "View your account profile information."}</p>
          </div>
          <button aria-label={`Close ${title}`} onClick={onClose} type="button"><FiX /></button>
        </div>

        {!isSecurity ? (
          <Card className="profile-settings-card">
            <div className="profile-picture-editor">
              <ProfileAvatar className="profile-avatar-large" name={user?.fullName} src={avatarUrl} />
              <div>
                <h2>Profile Picture</h2>
                <p>Upload a photo and crop it inside the circle.</p>
                <button className="profile-picture-upload" onClick={() => fileInputRef.current?.click()} type="button">
                  <FiUpload /> Upload Picture
                </button>
                <input accept="image/*" hidden onChange={chooseAvatar} ref={fileInputRef} type="file" />
              </div>
            </div>
            <h2>Account Information</h2>
            <div className="info-list">
              <span>Full Name <strong>{user?.fullName || "-"}</strong></span>
              <span>Email <strong>{user?.email || "-"}</strong></span>
              <span>Role <strong>{user?.role || "-"}</strong></span>
            </div>
          </Card>
        ) : (
          <Card>
            <h2>Change Password</h2>
            <form className="stack-form" onSubmit={handleSubmit(updatePassword)}>
              <Field label="Current Password" type="password" {...register("currentPassword", { required: true })} />
              <Field label="New Password" type="password" {...register("newPassword", { required: true, minLength: 6 })} />
              <Field
                label="Confirm Password"
                type="password"
                {...register("confirmPassword", {
                  required: true,
                  validate: (value) => value === watch("newPassword"),
                })}
              />
              <Button disabled={isSubmitting}>{isSubmitting ? "Updating..." : "Update Password"}</Button>
            </form>
          </Card>
        )}

        {cropImage ? (
          <div className="avatar-crop-backdrop" onClick={() => setCropImage("")} role="presentation">
            <section className="avatar-crop-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
              <header>
                <div>
                  <h2>Adjust Profile Picture</h2>
                  <p>Position your photo inside the circle.</p>
                </div>
                <button aria-label="Close crop editor" onClick={() => setCropImage("")} type="button"><FiX /></button>
              </header>
              <div className="avatar-crop-preview">
                <img
                  alt="Profile crop preview"
                  src={cropImage}
                  style={{
                    transform: `translate(${crop.x}px, ${crop.y}px) scale(${crop.zoom})`,
                  }}
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
      </section>
    </div>
  );
}
