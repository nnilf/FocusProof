/** FocusProof mark: a focus ring with a centred dot. Same geometry as resources/icon.ico (scripts/make-icon.mjs). */
export function Logo(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="18" fill="none" stroke="var(--c-productive)" strokeWidth="5" />
      <circle cx="32" cy="32" r="7" fill="var(--c-productive)" />
    </svg>
  );
}
