/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' — сборка без серверной части (витрина на статическом хостинге). */
  readonly VITE_DEMO_ONLY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
