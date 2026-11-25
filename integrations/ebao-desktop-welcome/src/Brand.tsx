/** The logo is decorative beside the visible product name. No account data enters this component. */
export function EbaoBrand({ name }: { name: string }) {
  return <div className="brand ebao-brand">
    <img className="ebao-brand-image" src="../lib/welcome/ebao-robot.webp" alt="" aria-hidden="true" width="64" height="64" />
    <span className="ebao-brand-name">{name}</span>
  </div>
}
