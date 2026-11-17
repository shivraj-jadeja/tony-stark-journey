// The currently selected suit, shared by the reactor chart and the timeline (coordinated views).
const listeners = new Set();
let current = null;

export const selectedSuit = () => current;

export function selectSuit(suit) {
  if (suit === current) return;
  current = suit;
  listeners.forEach(fn => fn(suit));
}

export function onSuitSelect(fn) {
  listeners.add(fn);
  if (current) fn(current);
  return () => listeners.delete(fn);
}
