/** 試聽用的共用 AudioContext：旋律與和弦要排在同一條時間軸上才對得齊。 */
let ctx: AudioContext | null = null;

type SessionType = 'auto' | 'playback' | 'play-and-record' | 'ambient' | 'transient' | 'transient-solo';

/**
 * iPhone 的靜音開關預設會把網頁聲音關掉（Web Audio 被當成「提示音」）。
 * Safari 16.4 起的 Audio Session API 可以把網頁標成「播放媒體」，靜音模式下仍會出聲，
 * 錄音時則要切成「播放並錄音」。其他瀏覽器沒有這個 API，什麼都不做。
 */
export function setAudioSession(type: SessionType): void {
  const session = (navigator as Navigator & { audioSession?: { type: SessionType } }).audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {
    /* 舊版 Safari 不接受某些值，忽略 */
  }
}

export function getContext(): AudioContext {
  if (!ctx) {
    setAudioSession('playback');
    ctx = new AudioContext();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
