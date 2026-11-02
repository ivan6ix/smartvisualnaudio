import { useEffect, useRef, useState } from "react";
import { FiMessageCircle } from "react-icons/fi";

// Top bar message menu: opens on click (not hover) and closes on an outside click or Escape.
// onOpenMessages(conversationId?) opens the full messages window, at a conversation when one is given.
export default function MessageMenu({ className = "message-menu", conversations = [], unreadCount = 0, onOpenMessages }) {
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointer(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    }
    function handleKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function openMessages(conversationId) {
    setOpen(false);
    onOpenMessages(conversationId);
  }

  return (
    <div className={`${className} ${open ? "open" : ""}`} ref={menuRef}>
      <button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((current) => !current)} title="Messages" type="button">
        <FiMessageCircle />{unreadCount ? <span>{unreadCount}</span> : null}
      </button>
      <div className="message-menu-panel" role="menu">
        <header>
          <strong>Messages</strong>
          <button onClick={() => openMessages()} type="button">Open messages</button>
        </header>
        {conversations.length ? conversations.map((conversation) => (
          <article key={conversation.id} onClick={() => openMessages(conversation.id)}>
            <div>
              <b>{conversation.name}</b>
              <small>{conversation.role}</small>
            </div>
            <p>{conversation.lastMessage}</p>
            {conversation.unread ? <span>{conversation.unread}</span> : null}
          </article>
        )) : <p className="message-menu-empty">No live messages yet.</p>}
      </div>
    </div>
  );
}
