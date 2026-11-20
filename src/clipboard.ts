// Clipboard helpers. Calls must start inside a user gesture (iOS Safari enforces this).

export async function copySecret(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    // Fallback for older WebKit: a hidden textarea plus execCommand.
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, s.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** Overwrite the clipboard so the password doesn't linger. */
export function clearClipboard(): Promise<boolean> {
  return copySecret(" ");
}
