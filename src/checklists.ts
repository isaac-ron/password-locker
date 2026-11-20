// Per-platform lock-down steps. Each step closes one way back in.
// Menu paths change over time, so the "why" matters more than the exact clicks.

export interface Step {
  id: string;
  text: string;
  why: string;
  /** Step needs the pending password on the clipboard. */
  usesPassword?: boolean;
}

export const DEVICE_PREP: Step[] = [
  {
    id: "clip-win",
    text: "Windows PC: Settings → System → Clipboard → turn OFF “Clipboard history” and “Clipboard sync across devices”.",
    why: "Win+V history would keep every password you paste, readable any time.",
  },
  {
    id: "clip-ios",
    text: "iPhone + any Mac: Settings → General → AirPlay & Continuity (Handoff) → turn OFF Handoff.",
    why: "Universal Clipboard syncs copied passwords to your other Apple devices.",
  },
  {
    id: "pw-save",
    text: "iPhone: Settings → Apps → Passwords → Password Options → turn OFF AutoFill (or at least tap “Never for this website” on every save prompt). On PC, turn off “Offer to save passwords” in your browser.",
    why: "A saved password in iCloud Keychain or the browser makes the lock pointless.",
  },
  {
    id: "home-screen",
    text: "iPhone: open this site in Safari → Share → “Add to Home Screen”, and only use the vault from that icon from now on.",
    why: "Home-screen apps keep their storage. Safari tabs can lose site data after 7 days without a visit, and the two keep separate vaults.",
  },
];

export const RECOVERY_EMAIL: Step[] = [
  {
    id: "create",
    text: "Create a brand-new email account (Proton Mail or Tuta recommended) used ONLY as the recovery address for X and Reddit. Use the password the vault generated: copy it, paste it into signup. Don't type it, don't save it.",
    why: "X and Reddit can be reset or logged into through email. If that's your main inbox, you could get in any time.",
    usesPassword: true,
  },
  {
    id: "no-recovery",
    text: "In the new email's settings: NO recovery phone, NO recovery email, and skip or don't store a recovery phrase (or lock it here as another emergency-only entry).",
    why: "Each recovery method on the email is a way around the lock.",
  },
  {
    id: "no-forward",
    text: "Do NOT set up forwarding from this mailbox to your main inbox.",
    why: "Forwarding would deliver password-reset links straight to you.",
  },
  {
    id: "stay-in",
    text: "Stay logged in to the email in a private window until X and Reddit are both done. You'll need to click their verification links.",
    why: "Once you log out, you can only get back in through the 72h emergency path.",
  },
];

export const RECOVERY_EMAIL_FINISH: Step[] = [
  {
    id: "logout",
    text: "After X and Reddit are locked: log out of the email everywhere and close the private window. Don't add it to the iPhone Mail app.",
    why: "A logged-in session is as good as the password.",
  },
];

export const X_STEPS: Step[] = [
  {
    id: "email",
    text: "X → Settings → Your account → Account information → Email: change to the dedicated recovery email and confirm the code from it.",
    why: "Password resets and login codes go to this address.",
  },
  {
    id: "phone",
    text: "Account information → Phone: DELETE the phone number. If you use SMS 2FA, switch to an authenticator app first (or turn 2FA off).",
    why: "SMS reset is the easiest bypass: your phone is always in your pocket.",
  },
  {
    id: "sso",
    text: "Settings → Security and account access → Apps and sessions → Connected accounts: disconnect Google and Apple.",
    why: "“Sign in with Google/Apple” skips the password entirely.",
  },
  {
    id: "backup",
    text: "If you have 2FA on: Security → Two-factor authentication → Backup codes. Lock the backup code here as a separate emergency-only entry, then make sure no other copy exists.",
    why: "Backup codes aren't a password, but keep them out of reach anyway.",
  },
  {
    id: "change",
    text: "Settings → Your account → Change your password: enter your current password, then paste the vault's new password (Copy button above) into both new fields. Save.",
    why: "This is the actual lock.",
    usesPassword: true,
  },
  {
    id: "sessions",
    text: "Security and account access → Apps and sessions → Sessions → “Log out all other sessions”.",
    why: "The X app on your iPhone stays logged in otherwise.",
  },
  {
    id: "verify",
    text: "VERIFY: log out, then log back in by pasting the new password. Only continue if it works.",
    why: "If the paste went wrong, the account would be stuck behind the lock with an unknown password.",
    usesPassword: true,
  },
  {
    id: "final-logout",
    text: "Log out on this device, delete the X app from your iPhone, and tap “Never” on any save-password prompt.",
    why: "No live sessions, no saved credentials.",
  },
];

export const REDDIT_STEPS: Step[] = [
  {
    id: "email",
    text: "Reddit → Settings → Account → Email address: change to the dedicated recovery email and verify it from that inbox.",
    why: "Reddit sends password resets AND one-time email login codes to this address.",
  },
  {
    id: "phone",
    text: "Settings → Account: if a phone number is listed, remove it.",
    why: "Phone-based login or reset would bypass the lock.",
  },
  {
    id: "sso",
    text: "Settings → Account → Connected accounts: disconnect Google and Apple (Reddit asks you to set a password first if you signed up through one of them).",
    why: "“Continue with Google/Apple” skips the password.",
  },
  {
    id: "backup",
    text: "If you use 2FA: Settings → Safety / Account → Two-factor authentication → backup codes. Lock them here as an emergency-only entry.",
    why: "Keep every credential behind the lock.",
  },
  {
    id: "change",
    text: "Settings → Account → Change password: current password, then paste the vault's new password. Save.",
    why: "This is the actual lock.",
    usesPassword: true,
  },
  {
    id: "sessions",
    text: "Check that other sessions were logged out (Reddit usually does this on a password change). If you're unsure, sign out on the iPhone app manually.",
    why: "An existing app session would make the lock pointless.",
  },
  {
    id: "verify",
    text: "VERIFY: log out, then log back in by pasting the new password. Only continue if it works.",
    why: "A bad paste would lock you out for real.",
    usesPassword: true,
  },
  {
    id: "final-logout",
    text: "Log out on this device, delete the Reddit app from your iPhone, and never save the password.",
    why: "No live sessions, no saved credentials.",
  },
];

export const RELOCK_STEPS: Step[] = [
  {
    id: "change",
    text: "On the site: Change password → paste the CURRENT password (shown above) as the old one, then copy and paste the NEW password. Save.",
    why: "The current password has been revealed and is now permanently decryptable, so it has to be retired.",
    usesPassword: true,
  },
  {
    id: "verify",
    text: "Log out and back in with the NEW password to verify.",
    why: "Don't lock away a password you haven't checked.",
    usesPassword: true,
  },
  {
    id: "logout",
    text: "Log out everywhere when you're done, and clear the clipboard.",
    why: "The next window opens in about 24h.",
  },
];

export function stepsFor(site: string): Step[] {
  if (site === "x") return X_STEPS;
  if (site === "reddit") return REDDIT_STEPS;
  if (site === "email") return [...RECOVERY_EMAIL, ...RECOVERY_EMAIL_FINISH];
  return [];
}
