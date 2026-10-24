// PaperMan wears the studio's expressions.
//
//   happy  — nothing is wrong, or the page is simply waiting for a choice
//   normal — something is empty, and that is all
//   sad    — something needs a person
export const MOODS = ['happy', 'normal', 'sad'];

export const moodImage = (mood = 'normal', light = false) =>
  `/paperman-${MOODS.includes(mood) ? mood : 'normal'}${light ? '-light' : ''}.png`;

// The expression the studio assistant wears, given what needs attention.
export function moodFor(attention) {
  if (!attention) return 'normal';
  const counts = {
    overdue: (attention.overdue || []).length,
    dueSoon: (attention.due_soon || []).length,
    unassigned: (attention.unassigned || []).length,
    stale: (attention.stale || []).length
  };
  if (counts.overdue || counts.dueSoon) return 'sad';
  if (counts.unassigned || counts.stale) return 'normal';
  return 'happy';
}
