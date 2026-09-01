// Where the player left off.
//
// Kept apart from progress, because it answers a different question. Progress
// says what has been finished; this says where you were standing. A player who
// has beaten forty levels still wants one button, and it should say the name of
// the chapter they were in last night.
//
// Deliberately not synced to the server. "Where I was" is about this device and
// this sitting: syncing it would mean a phone opened at breakfast jumps the
// desktop to a different chapter, which is not helpful, it is startling.

const KEY = 'goo.recent.v1'

export function remember(spot) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...spot, at: Date.now() }))
  } catch {
    // Private mode, full quota — losing the bookmark is not worth an error.
  }
}

export function lastSpot() {
  try {
    const spot = JSON.parse(localStorage.getItem(KEY))
    return spot?.storyId ? spot : null
  } catch {
    return null
  }
}

export function forget() {
  localStorage.removeItem(KEY)
}
