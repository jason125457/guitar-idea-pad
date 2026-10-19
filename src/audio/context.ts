/** 試聽用的共用 AudioContext：旋律與和弦要排在同一條時間軸上才對得齊。 */
let ctx: AudioContext | null = null;

export function getContext(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
