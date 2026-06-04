import { useState } from "react";
import { FiEdit3, FiX } from "react-icons/fi";
import LiveMessages from "./LiveMessages";

export default function MessageModal({ onClose }) {
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <div className="message-modal-backdrop" onClick={onClose} role="presentation">
      <section className="message-modal" onClick={(event) => event.stopPropagation()}>
        <div className="message-modal-actions">
          <button className="message-modal-new" onClick={() => setComposeOpen((current) => !current)} type="button">
            <FiEdit3 /> New Message
          </button>
          <button aria-label="Close messages" className="message-modal-close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>
        <LiveMessages composeOpen={composeOpen} onComposeClose={() => setComposeOpen(false)} subtitle="Send and receive messages without leaving this page." />
      </section>
    </div>
  );
}
