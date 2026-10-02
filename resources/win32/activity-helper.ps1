# FocusProof activity helper.
# Emits one JSON line per second describing the foreground window and how much input occurred.
# Input is detected by sampling GetLastInputInfo; no key codes, text or click positions are read.
param([int]$ParentPid = 0, [int]$SampleMs = 200)

$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LtSampler {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("kernel32.dll")] static extern uint GetTickCount();

  static uint lastTick;
  static int cx, cy;
  public static int Keyboard, Mouse;
  public static bool Active;

  static uint LastInputTick() {
    var li = new LASTINPUTINFO();
    li.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    GetLastInputInfo(ref li);
    return li.dwTime;
  }

  public static void Init() {
    lastTick = LastInputTick();
    POINT p; GetCursorPos(out p); cx = p.X; cy = p.Y;
  }

  public static void Sample() {
    uint tick = LastInputTick();
    POINT p; GetCursorPos(out p);
    if (tick != lastTick) {
      if (p.X != cx || p.Y != cy) Mouse++; else Keyboard++;
      Active = true;
      lastTick = tick;
    }
    cx = p.X; cy = p.Y;
  }

  public static void Reset() { Keyboard = 0; Mouse = 0; Active = false; }

  public static uint IdleMs() { unchecked { return GetTickCount() - LastInputTick(); } }

  public static string ForegroundTitle(out uint pid) {
    IntPtr h = GetForegroundWindow();
    pid = 0;
    if (h == IntPtr.Zero) return "";
    GetWindowThreadProcessId(h, out pid);
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }
}
"@

$names = @{}
[LtSampler]::Init()
$samplesPerEmit = [Math]::Max(1, [int](1000 / $SampleMs))
$n = 0
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  [LtSampler]::Sample()
  $n++
  if ($n -ge $samplesPerEmit) {
    $n = 0
    if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
    $procId = [uint32]0
    $title = [LtSampler]::ForegroundTitle([ref]$procId)
    $proc = $null
    if ($procId -ne 0) {
      if ($names.ContainsKey($procId)) { $proc = $names[$procId] }
      else {
        try { $proc = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $proc = $null }
        $names[$procId] = $proc
      }
    }
    $line = @{
      t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      proc = $proc
      title = $title
      idle = [LtSampler]::IdleMs()
      kb = [LtSampler]::Keyboard
      ms = [LtSampler]::Mouse
      active = [LtSampler]::Active
    } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    [LtSampler]::Reset()
  }
  Start-Sleep -Milliseconds $SampleMs
}
