import { useMemo, useState } from "react";
import { FiArchive, FiCopy, FiFolder, FiMoreVertical, FiRefreshCw, FiTrash2, FiUpload, FiX } from "react-icons/fi";
import { toast } from "sonner";
import { studentFiles, studentFolders } from "../../data/studentData";
import useLocalStorageState from "../../hooks/useLocalStorageState";

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

export default function StudentResources() {
  const [folders, setFolders] = useLocalStorageState("smartproctor.student.resourceFolders", studentFolders);
  const [files, setFiles] = useLocalStorageState("smartproctor.student.resourceFiles", studentFiles);
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

  function handleCreateFolder(event) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;

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

  function handleMoveFile(event) {
    event.preventDefault();
    if (!shareFile || !shareTarget) return;
    setFiles((current) => current.map((file) => file.id === shareFile.id ? { ...file, folderId: shareTarget } : file));
    setShareFile(null);
    setShareTarget("");
  }

  function handleCopyFile(event) {
    event.preventDefault();
    if (!copyFile || !copyTarget) return;
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

  function archiveFolder(folderId) {
    setFolders((current) => current.map((folder) => folder.id === folderId ? { ...folder, archived: true } : folder));
    if (selectedFolderId === folderId) {
      const nextFolder = activeFolders.find((folder) => folder.id !== folderId);
      setSelectedFolderId(nextFolder?.id || "");
    }
  }

  function restoreFolder(folderId) {
    setFolders((current) => current.map((folder) => folder.id === folderId ? { ...folder, archived: false } : folder));
    setSelectedFolderId(folderId);
  }

  function deleteFolder(folderId) {
    setFolders((current) => current.filter((folder) => folder.id !== folderId));
    setFiles((current) => current.filter((file) => file.folderId !== folderId));
  }

  function archiveFile(fileId) {
    setFiles((current) => current.map((file) => file.id === fileId ? { ...file, archived: true } : file));
    setOpenFileMenu("");
  }

  function restoreFile(fileId) {
    setFiles((current) => current.map((file) => file.id === fileId ? { ...file, archived: false } : file));
  }

  function deleteFile(fileId) {
    setFiles((current) => current.filter((file) => file.id !== fileId));
  }

  return (
    <section className="student-page">
      <div className="student-page-header">
        <div>
          <h1>Resources</h1>
          <p>Create personal folders, upload files, and keep resources you want to open later.</p>
        </div>
      </div>

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
                      <FiFolder />
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
                  <button onClick={() => setPreviewFile(file)} type="button">Preview</button>
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
