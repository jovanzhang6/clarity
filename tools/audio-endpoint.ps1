param([switch]$Fix, [float]$Level = 0.5)
Add-Type @'
using System;
using System.Runtime.InteropServices;

public class AudioEndpoint {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorCom {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume endpoint);
  }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetVolumeRange(out float minDb, out float maxDb, out float stepDb);
    int SetMasterVolumeLevel(float levelDb, Guid context);
    int SetMasterVolumeLevelScalar(float level, Guid context);
    int GetMasterVolumeLevel(out float levelDb);
    int GetMasterVolumeLevelScalar(out float level);
    int SetMute(bool mute, Guid context);
    int GetMute(out bool mute);
  }

  static IMMDevice GetDefaultDevice() {
    var en = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorCom();
    IMMDevice dev = null;
    int hr = en.GetDefaultAudioEndpoint(0 /*eRender*/, 1 /*eMultimedia*/, out dev);
    if (hr != 0 || dev == null) throw new Exception("GetDefaultAudioEndpoint failed, hr=0x" + hr.ToString("X8"));
    return dev;
  }

  static IAudioEndpointVolume GetVolume() {
    var dev = GetDefaultDevice();
    var iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume vol = null;
    int hr = dev.Activate(ref iid, 1 /*CLSCTX_ALL*/, IntPtr.Zero, out vol);
    if (hr != 0 || vol == null) throw new Exception("Activate failed, hr=0x" + hr.ToString("X8"));
    return vol;
  }

  public static string GetState() {
    var vol = GetVolume();
    float level; bool mute;
    vol.GetMasterVolumeLevelScalar(out level);
    vol.GetMute(out mute);
    return string.Format("{{\"level\":{0},\"mute\":{1}}}", Math.Round(level, 3).ToString("0.000"), mute ? "true" : "false");
  }

  public static string Fix(float level) {
    var vol = GetVolume();
    vol.SetMute(false, Guid.Empty);
    vol.SetMasterVolumeLevelScalar(level, Guid.Empty);
    return GetState();
  }
}
'@

try {
  if ($Fix) {
    Write-Output ([AudioEndpoint]::Fix($Level))
  } else {
    Write-Output ([AudioEndpoint]::GetState())
  }
} catch {
  Write-Output ("ERROR: " + $_.Exception.Message)
}
