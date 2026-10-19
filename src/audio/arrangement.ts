import { getContext } from './context';
import { scheduleChords, stopAll, type TimedChord } from './pluck';
import { scheduleNotes, stopTones, type PlayableNote } from './tone';

/** 旋律（簡單音色）與和弦（吉他撥弦）排在同一條時間軸上同時播放；回傳總長（秒）。 */
export function playArrangement(notes: readonly PlayableNote[], chords: readonly TimedChord[]): number {
  stopArrangement();
  const c = getContext();
  const t0 = c.currentTime + 0.1;
  // 旋律放小聲一點，免得蓋過和弦
  const noteEnd = scheduleNotes(c, t0, notes, 0.18);
  scheduleChords(c, t0, chords, 0.8);
  const chordEnd = chords.reduce((m, ch) => Math.max(m, ch.startSec + ch.durSec), 0);
  return Math.max(noteEnd, chordEnd);
}

export function stopArrangement(): void {
  stopAll();
  stopTones();
}
