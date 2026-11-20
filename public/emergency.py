#!/usr/bin/env python3
"""Locker emergency solver: native-speed solver for the time-lock puzzles.

    pip install gmpy2
    python emergency.py calibrate               # measure this PC; enter the number in Locker → Settings
    python emergency.py solve vault.json        # pick an entry, then solve (resumable; Ctrl+C to pause)

Puzzles are sized to the speed `calibrate` reports, so on this PC a 72h puzzle
takes about 72h. When it finishes, the script prints a result code. Paste it into
Locker (the entry → Emergency → "Paste result") to reveal the password and re-lock.
"""
import json
import os
import sys
import time

# Windows consoles default to a legacy codepage; never crash on output.
try:
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass

try:
    import gmpy2
except ImportError:
    sys.exit("gmpy2 is required:  pip install gmpy2")

PHRASE = "this is a real emergency"
BATCH = 200_000  # squarings per powmod call (~0.3s on a fast PC)


def calibrate(seconds=5.0):
    import secrets
    n = gmpy2.mpz(secrets.randbits(2048) | (1 << 2047) | 1)
    y = gmpy2.mpz(secrets.randbits(2040))
    e = gmpy2.mpz(1) << 20_000
    done, t0 = 0, time.perf_counter()
    while time.perf_counter() - t0 < seconds:
        y = gmpy2.powmod(y, e, n)
        done += 20_000
    return int(done / (time.perf_counter() - t0))


def fmt(s):
    s = int(s)
    d, h, m = s // 86400, s % 86400 // 3600, s % 3600 // 60
    return f"{d}d {h}h {m}m" if d else f"{h}h {m}m"


def solve(vault_path):
    with open(vault_path, encoding="utf-8") as f:
        vault = json.load(f)
    entries = [e for e in vault.get("entries", []) if e.get("puzzle")]
    if not entries:
        sys.exit("No locked entries in this vault file.")
    for i, e in enumerate(entries, 1):
        print(f"  {i}. {e['label']}  ({e.get('username', '')})")
    pick = entries[int(input("Entry number: ")) - 1]
    pz = pick["puzzle"]
    pid = pz["n"][:32]
    ck_path = os.path.join(os.path.dirname(os.path.abspath(vault_path)), f"locker-emergency-{pid}.json")

    n, t = gmpy2.mpz(pz["n"], 16), int(pz["t"])
    done, y = 0, gmpy2.mpz(pz["x"], 16)
    if os.path.exists(ck_path):
        with open(ck_path, encoding="utf-8") as f:
            ck = json.load(f)
        done, y = int(ck["done"]), gmpy2.mpz(ck["y"], 16)
        print(f"Resuming from {done / t:.2%}")
    else:
        print(f"\nThis takes about {pz['targetHours']}h of nonstop computation. Keep the PC awake.")
        if input(f'Type "{PHRASE}" to start: ').strip().lower() != PHRASE:
            sys.exit("Cancelled.")

    def save():
        tmp = ck_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"done": done, "y": format(y, "x")}, f)
        os.replace(tmp, ck_path)

    t0, d0, last_save = time.perf_counter(), done, time.perf_counter()
    try:
        while done < t:
            k = min(BATCH, t - done)
            y = gmpy2.powmod(y, gmpy2.mpz(1) << k, n)
            done += k
            now = time.perf_counter()
            if now - last_save > 15 or done == t:
                save()
                last_save = now
            rate = (done - d0) / max(now - t0, 1e-9)
            print(f"\r{done / t:7.3%}   ~{fmt((t - done) / rate)} left   {rate:,.0f}/s   ", end="", flush=True)
    except KeyboardInterrupt:
        save()
        print(f"\nPaused at {done / t:.2%}. Run the same command again to resume.")
        return

    result = {"locker": "emergency-result", "pid": pid, "done": done, "y": format(y, "x")}
    print("\n\nDone. Paste this whole line into Locker > the entry > Emergency > Paste result:\n")
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "calibrate":
        print("Measuring (5s)...")
        print(f"\nNative speed: {calibrate():,} squarings/s")
        print("Enter this number in Locker > Settings > Native speed.")
    elif cmd == "solve" and len(sys.argv) > 2:
        solve(sys.argv[2])
    else:
        print(__doc__)
