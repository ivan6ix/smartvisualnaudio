import { useEffect, useMemo, useState } from "react";
import { FiArchive, FiCopy, FiFolder, FiFolderPlus, FiMoreVertical, FiRefreshCw, FiTrash2, FiUpload, FiX } from "react-icons/fi";
import { toast } from "sonner";
import { studentFiles, studentFolders } from "../../data/studentData";
import { useAuth } from "../../context/AuthContext";
import useLocalStorageState from "../../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function isMissingResourcesTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.includes("student_resource");
}

function mapFolder(row) {
  return {
    id: row.id,
    name: row.name,
    course: row.course_label || "Personal folder",
    courseId: row.course_id,
    type: row.folder_type || "Personal folder",
    archived: row.archived,
  };
}

function mapFile(row) {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.file_name,
    size: formatBytes(row.file_size),
    fileSize: row.file_size,
    mimeType: row.mime_type,
    filePath: row.file_path,
    archived: row.archived,
  };
}

function safeStorageName(name) {
  return name.replace(/[^\w.\-]+/g, "_");
}

export default function StudentResources() {
  const { user } = useAuth();
  const [localFolders, setLocalFolders] = useLocalStorageState("smartproctor.student.resourceFolders", studentFolders);
  const [localFiles, setLocalFiles] = useLocalStorageState("smartproctor.student.resourceFiles", studentFiles);
  const [liveFolders, setLiveFolders] = useState([]);
  const [liveFiles, setLiveFiles] = useState([]);
  const [resourcesReady, setResourcesReady] = useState(false);
  const [resourcesOnline, setResourcesOnline] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState(studentFolders[0]?.id || "");
  const [previewFile, setPreviewFile] = useState(null);
  const [shareFile, setShareFile] = useState(null);
  const [shareTarget, setShareTarget] = useState("");
  const [copyFile, setCopyFile] = useState(null);
  const [copyTarget, setCopyTarget] = useState("");
  const [openFileMenu, setOpenFileMenu] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [resourceSearch, setResourceSearch] = useState("");
  const useSupabaseResources = hasSupabaseConfig && resourcesOnline && user?.id;
  const folders = useSupabaseResources ? liveFolders : localFolders;
  const files = useSupabaseResources ? liveFiles : localFiles;
  const setFolders = useSupabaseResources ? setLiveFolders : setLocalFolders;
  const setFiles = useSupabaseResources ? setLiveFiles : setLocalFiles;
  const activeFolders = folders.filter((folder) => !folder.archived);
  const archivedFolders = folders.filter((folder) => folder.archived);
  const archivedFiles = files.filter((file) => file.archived);
  const normalizedSearch = resourceSearch.trim().toLowerCase();
  const matchingFolderIdsByFile = useMemo(() => {
    if (!normalizedSearch) return new Set();
    return new Set(
      files
        .filter((file) => !file.archived && file.name.toLowerCase().includes(normalizedSearch))
        .map((file) => file.folderId),
    );
  }, [files, normalizedSearch]);
  const visibleFolders = useMemo(() => {
    if (!normalizedSearch) return activeFolders;
    return activeFolders.filter((folder) => (
      folder.name.toLowerCase().includes(normalizedSearch)
      || folder.course.toLowerCase().includes(normalizedSearch)
      || matchingFolderIdsByFile.has(folder.id)
    ));
  }, [activeFolders, matchingFolderIdsByFile, normalizedSearch]);
  const selectedFolder = activeFolders.find((folder) => folder.id === selectedFolderId) || activeFolders[0];
  const selectedFiles = files.filter((file) => file.folderId === selectedFolder?.id && !file.archived);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    let active = true;

    async function loadResources() {
      const [foldersResponse, filesResponse] = await Promise.all([
        supabase
          .from("student_resource_folders")
          .select("id, name, course_label, course_id, folder_type, archived, created_at")
          .eq("student_id", user.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("student_resource_files")
          .select("id, folder_id, file_name, file_path, file_size, mime_type, archived, created_at")
          .eq("student_id", user.id)
          .order("created_at", { ascending: true }),
      ]);

      if (foldersResponse.error || filesResponse.error) {
        const error = foldersResponse.error || filesResponse.error;
        if (isMissingResourcesTable(error)) {
          toast.error("Run the student resources SQL in Supabase first.");
        } else {
          toast.error(error.message);
        }
        if (active) {
          setResourcesOnline(false);
          setResourcesReady(true);
        }
        return;
      }

      if (active) {
        const nextFolders = (foldersResponse.data || []).map(mapFolder);
        setLiveFolders(nextFolders);
        setLiveFiles((filesResponse.data || []).map(mapFile));
        setResourcesOnline(true);
        setResourcesReady(true);
        setSelectedFolderId((current) => current || nextFolders.find((folder) => !folder.archived)?.id || "");
      }
    }

    loadResources();

    const channel = supabase
      .channel(`student-resources-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "student_resource_folders", filter: `student_id=eq.${user.id}` }, () => void loadResources())
      .on("postgres_changes", { event: "*", schema: "public", table: "student_resource_files", filter: `student_id=eq.${user.id}` }, () => void loadResources())
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function handleCreateFolder(event) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;

    if (useSupabaseResources) {
      const { data, error } = await supabase
        .from("student_resource_folders")
        .insert({
          student_id: user.id,
          name,
          course_label: "Personal folder",
          folder_type: "Personal folder",
          archived: false,
        })
        .select("id, name, course_label, course_id, folder_type, archived")
        .single();

      if (error) {
        toast.error(error.message);
        return;
      }

      const folder = mapFolder(data);
      setFolders((current) => [...current, folder]);
      setSelectedFolderId(folder.id);
      setFolderName("");
      toast.success("Folder created.");
      return;
    }

    const folder = {
      id: crypto.randomUUID(),
      name,
      course: "Personal folder",
      courseId: null,
      type: "Personal folder",
      archived: false,
    };
    setFolders((current) => [...current, folder]);
    setSelectedFolderId(folder.id);
    setFolderName("");
  }

  async function handleUpload(event) {
    const uploaded = Array.from(event.target.files || []);
    if (!selectedFolder || !uploaded.length) return;

    if (useSupabaseResources) {
      const storedFiles = [];

      for (const file of uploaded) {
        const path = `${user.id}/${selectedFolder.id}/${crypto.randomUUID()}-${safeStorageName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from("student-resources").upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

        if (uploadError) {
          toast.error(uploadError.message?.toLowerCase().includes("bucket not found") ? "Run the student-resources bucket SQL first." : uploadError.message);
          continue;
        }

        const { data, error } = await supabase
          .from("student_resource_files")
          .insert({
            folder_id: selectedFolder.id,
            student_id: user.id,
            file_name: file.name,
            file_path: path,
            file_size: file.size,
            mime_type: file.type,
            archived: false,
          })
          .select("id, folder_id, file_name, file_path, file_size, mime_type, archived")
          .single();

        if (error) {
          await supabase.storage.from("student-resources").remove([path]);
          toast.error(error.message);
          continue;
        }

        storedFiles.push(mapFile(data));
      }

      if (storedFiles.length) {
        setFiles((current) => [...current, ...storedFiles]);
        toast.success(`${storedFiles.length} file${storedFiles.length === 1 ? "" : "s"} uploaded.`);
      }
      event.target.value = "";
      return;
    }

    const storedFiles = await Promise.all(uploaded.map(async (file) => ({
      id: crypto.randomUUID(),
      folderId: selectedFolder.id,
      name: file.name,
      size: formatBytes(file.size),
      mimeType: file.type,
      previewUrl: await readFileAsDataUrl(file),
      archived: false,
    })));

    setFiles((current) => [
      ...current,
      ...storedFiles,
    ]);
    event.target.value = "";
  }

  async function handleMoveFile(event) {
    event.preventDefault();
    if (!shareFile || !shareTarget) return;
    if (useSupabaseResources) {
      const { error } = await supabase
        .from("student_resource_files")
        .update({ folder_id: shareTarget })
        .eq("id", shareFile.id)
        .eq("student_id", user.id);

      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setFiles((current) => current.map((file) => file.id === shareFile.id ? { ...file, folderId: shareTarget } : file));
    setShareFile(null);
    setShareTarget("");
  }

  async function handleCopyFile(event) {
    event.preventDefault();
    if (!copyFile || !copyTarget) return;

    if (useSupabaseResources) {
      let nextPath = copyFile.filePath;
      if (copyFile.filePath) {
        nextPath = `${user.id}/${copyTarget}/${crypto.randomUUID()}-${safeStorageName(copyFile.name)}`;
        const { error: copyError } = await supabase.storage.from("student-resources").copy(copyFile.filePath, nextPath);
        if (copyError) {
          toast.error(copyError.message);
          return;
        }
      }

      const { data, error } = await supabase
        .from("student_resource_files")
        .insert({
          folder_id: copyTarget,
          student_id: user.id,
          file_name: copyFile.name,
          file_path: nextPath,
          file_size: copyFile.fileSize,
          mime_type: copyFile.mimeType,
          archived: false,
        })
        .select("id, folder_id, file_name, file_path, file_size, mime_type, archived")
        .single();

      if (error) {
        if (nextPath && nextPath !== copyFile.filePath) await supabase.storage.from("student-resources").remove([nextPath]);
        toast.error(error.message);
        return;
      }

      setFiles((current) => [...current, mapFile(data)]);
      setCopyFile(null);
      setCopyTarget("");
      toast.success("File copied to folder");
      return;
    }

    setFiles((current) => [
      ...current,
      {
        ...copyFile,
        id: crypto.randomUUID(),
        folderId: copyTarget,
        copiedFrom: copyFile.id,
        archived: false,
      },
    ]);
    setCopyFile(null);
    setCopyTarget("");
    toast.success("File copied to folder");
  }

  function openShareModal(file) {
    setShareFile(file);
    setShareTarget(activeFolders.find((folder) => folder.id !== file.folderId)?.id || "");
  }

  function openCopyModal(file) {
    setCopyFile(file);
    setCopyTarget(activeFolders.find((folder) => folder.id !== file.folderId)?.id || "");
  }

  async function archiveFolder(folderId) {
    if (useSupabaseResources) {
      const { error } = await supabase
        .from("student_resource_folders")
        .update({ archived: true })
        .eq("id", folderId)
        .eq("student_id", user.id);

      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setFolders((current) => current.map((folder) => folder.id === folderId ? { ...folder, archived: true } : folder));
    if (selectedFolderId === folderId) {
      const nextFolder = activeFolders.find((folder) => folder.id !== folderId);
      setSelectedFolderId(nextFolder?.id || "");
    }
  }

  async function restoreFolder(folderId) {
    if (useSupabaseResources) {
      const { error } = await supabase
        .from("student_resource_folders")
        .update({ archived: false })
        .eq("id", folderId)
        .eq("student_id", user.id);

      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setFolders((current) => current.map((folder) => folder.id === folderId ? { ...folder, archived: false } : folder));
    setSelectedFolderId(folderId);
  }

  async function deleteFolder(folderId) {
    if (useSupabaseResources) {
      const folderFiles = files.filter((file) => file.folderId === folderId && file.filePath).map((file) => file.filePath);
      if (folderFiles.length) {
        await supabase.storage.from("student-resources").remove(folderFiles);
      }

      const { error } = await supabase
        .from("student_resource_folders")
        .delete()
        .eq("id", folderId)
        .eq("student_id", user.id);

      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setFolders((current) => current.filter((folder) => folder.id !== folderId));
    setFiles((current) => current.filter((file) => file.folderId !== folderId));
  }

  async function archiveFile(fileId) {
    if (useSupabaseResources) {
      const { error } = await supabase
        .from("student_resource_files")
        .update({ archived: true })
        .eq("id", fileId)
        .eq("student_id", user.id);

      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setFiles((current) => current.map((file) => file.id === fileId ? { ...file, archived: true } : file));
    setOpenFileMenu("");
  }

  async function restoreFile(fileId) {
    if (useSupabaseResources) {
      const { error } = await supabase
        .from("student_resource_files")
        .update({ archived: false })
        .eq("id", fileId)
        .eq("student_id", user.id);

      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setFiles((current) => current.map((file) => file.id === fileId ? { ...file, archived: false } : file));
  }

  async function deleteFile(fileId) {
    const file = files.find((item) => item.id === fileId);
    if (useSupabaseResources) {
      if (file?.filePath) {
        await supabase.storage.from("student-resources").remove([file.filePath]);
      }

      const { error } = await supabase
        .from("student_resource_files")
        .delete()
        .eq("id", fileId)
        .eq("student_id", user.id);

      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setFiles((current) => current.filter((file) => file.id !== fileId));
  }

  async function openPreview(file) {
    if (useSupabaseResources && file.filePath) {
      const { data, error } = await supabase.storage.from("student-resources").createSignedUrl(file.filePath, 60 * 60);
      if (error) {
        toast.error(error.message);
        return;
      }
      setPreviewFile({ ...file, previewUrl: data?.signedUrl || "" });
      return;
    }

    setPreviewFile(file);
  }

  return (
    <section className="student-page">
      <div className="student-page-header">
        <div>
          <h1>Resources</h1>
          <p>Create personal folders, upload files, and keep resources you want to open later.</p>
        </div>
      </div>
      {hasSupabaseConfig && user?.id && resourcesReady && !resourcesOnline ? (
        <div className="student-empty-box">Resources are using local storage until the Supabase student resources SQL is applied.</div>
      ) : null}

      <div className="student-resources-layout">
        <form className="student-card student-folder-form" onSubmit={handleCreateFolder}>
          <h2>Create Folder</h2>
          <input onChange={(event) => setFolderName(event.target.value)} placeholder="Folder name" value={folderName} />
          <button className="student-primary-button" type="submit">Create Folder</button>
        </form>

        <div className="student-folders-column">
          <div className="student-folder-outside-actions">
            <button onClick={() => setArchiveOpen(true)} type="button">
              <FiArchive /> View Archives
            </button>
          </div>

          <section className="student-card">
            <div className="student-card-title">
              <h2>My Folders</h2>
              <span>{activeFolders.length} folders</span>
            </div>
            <label className="student-folder-search">
              <span>Search folders and files</span>
              <input
                onChange={(event) => setResourceSearch(event.target.value)}
                placeholder="Search folder or file name"
                type="search"
                value={resourceSearch}
              />
            </label>
            {activeFolders.length ? (
              visibleFolders.length ? (
                <div className="student-folder-grid student-folder-grid-scroll">
                  {visibleFolders.map((folder) => (
                  <article className={folder.id === selectedFolder?.id ? "active" : ""} key={folder.id}>
                    <button className="student-folder-open" onClick={() => setSelectedFolderId(folder.id)} type="button">
                      <FiFolderPlus />
                      <strong>{folder.name}</strong>
                      <span>{folder.course}</span>
                    </button>
                    <button aria-label={`Archive ${folder.name}`} className="student-folder-archive" onClick={() => archiveFolder(folder.id)} title="Archive folder" type="button">
                      <FiArchive />
                    </button>
                  </article>
                  ))}
                </div>
              ) : (
                <div className="student-empty-box">No folders or files match your search.</div>
              )
            ) : (
              <div className="student-empty-box">No folders created yet.</div>
            )}
          </section>
        </div>
      </div>

      {selectedFolder ? (
        <section className="student-card student-file-panel">
          <div className="student-card-title">
            <div>
              <h2>{selectedFolder.name}</h2>
              <p>Upload and manage files inside this folder.</p>
            </div>
            <label className="student-primary-button student-upload-button">
              <FiUpload /> Upload File
              <input multiple onChange={handleUpload} type="file" />
            </label>
          </div>
          <div className="student-file-list">
            {selectedFiles.map((file) => (
              <article key={file.id}>
                <div>
                  <strong>{file.name}</strong>
                  <span>{file.size}</span>
                </div>
                <div>
                  <button onClick={() => openPreview(file)} type="button">Preview</button>
                  <button className="blue" onClick={() => openShareModal(file)} type="button">Share to Folder</button>
                  <button onClick={() => openCopyModal(file)} type="button"><FiCopy /> Copy to</button>
                  <div className="student-file-menu">
                    <button aria-label={`More actions for ${file.name}`} onClick={() => setOpenFileMenu(openFileMenu === file.id ? "" : file.id)} type="button">
                      <FiMoreVertical />
                    </button>
                    {openFileMenu === file.id ? (
                      <div>
                        <button onClick={() => archiveFile(file.id)} type="button"><FiArchive /> Archive File</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
            {!selectedFiles.length ? <div className="student-empty-box">No files inside this folder yet.</div> : null}
          </div>
        </section>
      ) : null}

      {previewFile ? (
        <div className="student-modal-backdrop" onClick={() => setPreviewFile(null)} role="presentation">
          <section className="student-resource-modal student-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="student-share-header">
              <div>
                <h2>File Preview</h2>
                <p>{previewFile.name}</p>
              </div>
              <button aria-label="Close preview" onClick={() => setPreviewFile(null)} type="button"><FiX /></button>
            </div>
            <div className="student-preview-box">
              {previewFile.previewUrl && previewFile.mimeType?.startsWith("image/") ? <img alt={previewFile.name} src={previewFile.previewUrl} /> : null}
              {previewFile.previewUrl && previewFile.mimeType === "application/pdf" ? <iframe src={previewFile.previewUrl} title={previewFile.name} /> : null}
              {previewFile.previewUrl && previewFile.mimeType?.startsWith("text/") ? <iframe src={previewFile.previewUrl} title={previewFile.name} /> : null}
              {!previewFile.previewUrl || (!previewFile.mimeType?.startsWith("image/") && previewFile.mimeType !== "application/pdf" && !previewFile.mimeType?.startsWith("text/")) ? (
                <div>
                  <strong>{previewFile.name}</strong>
                  <span>{previewFile.size}</span>
                  <p>Preview is available for uploaded images, PDFs, and text files. This stored sample can be managed without downloading.</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {shareFile ? (
        <div className="student-modal-backdrop" onClick={() => setShareFile(null)} role="presentation">
          <form className="student-resource-modal" onClick={(event) => event.stopPropagation()} onSubmit={handleMoveFile}>
            <div className="student-share-header">
              <div>
                <h2>Share to Folder</h2>
                <p>Move {shareFile.name} to another folder.</p>
              </div>
              <button aria-label="Close share folder" onClick={() => setShareFile(null)} type="button"><FiX /></button>
            </div>
            <label className="student-join-field">
              <span>Target Folder</span>
              <select onChange={(event) => setShareTarget(event.target.value)} value={shareTarget}>
                {activeFolders.filter((folder) => folder.id !== shareFile.folderId).map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name} - {folder.course}</option>
                ))}
              </select>
            </label>
            <button className="student-primary-button" disabled={!shareTarget} type="submit">Move File</button>
          </form>
        </div>
      ) : null}

      {copyFile ? (
        <div className="student-modal-backdrop" onClick={() => setCopyFile(null)} role="presentation">
          <form className="student-resource-modal" onClick={(event) => event.stopPropagation()} onSubmit={handleCopyFile}>
            <div className="student-share-header">
              <div>
                <h2>Copy to Folder</h2>
                <p>Keep {copyFile.name} here and create another copy in a selected folder.</p>
              </div>
              <button aria-label="Close copy folder" onClick={() => setCopyFile(null)} type="button"><FiX /></button>
            </div>
            <label className="student-join-field">
              <span>Target Folder</span>
              <select onChange={(event) => setCopyTarget(event.target.value)} value={copyTarget}>
                {activeFolders.filter((folder) => folder.id !== copyFile.folderId).map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name} - {folder.course}</option>
                ))}
              </select>
            </label>
            <button className="student-primary-button" disabled={!copyTarget} type="submit">Copy File</button>
          </form>
        </div>
      ) : null}

      {archiveOpen ? (
        <div className="student-modal-backdrop" onClick={() => setArchiveOpen(false)} role="presentation">
          <section className="student-resource-modal student-archive-modal" onClick={(event) => event.stopPropagation()}>
            <div className="student-share-header">
              <div>
                <h2>Archives</h2>
                <p>Restore or permanently delete archived folders and files.</p>
              </div>
              <button aria-label="Close archives" onClick={() => setArchiveOpen(false)} type="button"><FiX /></button>
            </div>

            <div className="student-archive-grid">
              <div>
                <h3>Archived Folders</h3>
                {archivedFolders.length ? (
                  <div className="student-archive-list">
                    {archivedFolders.map((folder) => (
                      <article key={folder.id}>
                        <FiFolder />
                        <div>
                          <strong>{folder.name}</strong>
                          <span>{folder.course}</span>
                        </div>
                        <button onClick={() => restoreFolder(folder.id)} type="button"><FiRefreshCw /> Restore</button>
                        <button className="danger" onClick={() => deleteFolder(folder.id)} type="button"><FiTrash2 /> Delete</button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="student-empty-box">No archived folders.</div>
                )}
              </div>

              <div>
                <h3>Archived Files</h3>
                {archivedFiles.length ? (
                  <div className="student-archive-list">
                    {archivedFiles.map((file) => {
                      const folder = folders.find((item) => item.id === file.folderId);
                      return (
                        <article key={file.id}>
                          <FiArchive />
                          <div>
                            <strong>{file.name}</strong>
                            <span>{folder?.name || "Deleted folder"} - {file.size}</span>
                          </div>
                          <button onClick={() => restoreFile(file.id)} type="button"><FiRefreshCw /> Restore</button>
                          <button className="danger" onClick={() => deleteFile(file.id)} type="button"><FiTrash2 /> Delete</button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="student-empty-box">No archived files.</div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
