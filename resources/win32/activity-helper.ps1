# FocusProof activity helper.
# Emits one JSON line per second describing the foreground window and how much input occurred.
# Input is detected by sampling GetLastInputInfo; no key codes, text or click positions are read.
# With -ReadDomains 1, the address bar of a foreground browser is read via UI Automation and reduced
# to its domain inside this process; full web addresses are never written out.
param([int]$ParentPid = 0, [int]$SampleMs = 200, [int]$ReadDomains = 0)

$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -ReferencedAssemblies UIAutomationClient, UIAutomationTypes -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Automation;

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
  public static IntPtr LastHwnd;

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
    LastHwnd = h;
    pid = 0;
    if (h == IntPtr.Zero) return "";
    GetWindowThreadProcessId(h, out pid);
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  // --- Browser address bar -> domain -------------------------------------------------------
  static IntPtr cachedHwnd = IntPtr.Zero;
  static AutomationElement cachedEdit;
  static readonly Condition EditWithValue = new AndCondition(
    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
    new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true));
  static readonly Condition FirefoxUrlBar = new PropertyCondition(AutomationElement.AutomationIdProperty, "urlbar-input");

  /** Reduces address-bar text to a bare domain, or null for searches, internal pages and files. */
  public static string DomainOf(string text) {
    if (string.IsNullOrWhiteSpace(text)) return null;
    text = text.Trim();
    if (text.Contains(" ")) return null;
    if (!Regex.IsMatch(text, "^[a-zA-Z][a-zA-Z0-9+.-]*://")) text = "https://" + text;
    Uri u;
    if (!Uri.TryCreate(text, UriKind.Absolute, out u)) return null;
    if (u.Scheme != "http" && u.Scheme != "https") return null;
    string host = u.Host.ToLowerInvariant();
    if (host.StartsWith("www.")) host = host.Substring(4);
    return host.Contains(".") ? host : null;
  }

  /** Domain shown in the foreground browser's address bar (the address bar element is cached per window). */
  public static string BrowserDomain(bool firefox) {
    try {
      if (LastHwnd != cachedHwnd || cachedEdit == null) {
        cachedHwnd = LastHwnd;
        var root = AutomationElement.FromHandle(LastHwnd);
        cachedEdit = firefox ? root.FindFirst(TreeScope.Descendants, FirefoxUrlBar) : null;
        if (cachedEdit == null) cachedEdit = root.FindFirst(TreeScope.Descendants, EditWithValue);
      }
      if (cachedEdit == null) return null;
      object pattern;
      if (!cachedEdit.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return null;
      return DomainOf(((ValuePattern)pattern).Current.Value);
    } catch {
      cachedEdit = null;
      return null;
    }
  }
}
"@

$names = @{}
$browsers = @('chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi', 'chromium', 'arc')
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
    $domain = $null
    if ($ReadDomains -eq 1 -and $proc -and ($browsers -contains $proc.ToLowerInvariant())) {
      $domain = [LtSampler]::BrowserDomain($proc -ieq 'firefox')
    }
    $line = @{
      t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      proc = $proc
      title = $title
      domain = $domain
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
