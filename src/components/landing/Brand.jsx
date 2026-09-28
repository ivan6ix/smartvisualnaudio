import { ScanFace } from "lucide-react";
import styles from "./Landing.module.css";

export default function Brand() {
  return <span className={styles.brand}><span className={styles.brandMark}><ScanFace size={23} strokeWidth={1.6} /></span><span className={styles.brandText}>smart<span className={styles.brandLight}>proctor</span><span className={styles.brandDot}>.</span></span></span>;
}
