<template>
  <div class="menu">
    <WorldCanvas class="bg" :level="demo" />
    <div class="veil" />

    <AccountBadge class="badge" />

    <div class="content">
      <p class="eyebrow">Verlet physics · SVG · Vue</p>
      <h1 class="title">GOO</h1>
      <p class="lede">
        Build towers out of living balls and walk them to the pipe.<br />
        The ones drifting behind this text can be dragged too.
      </p>

      <!--
        Continue comes first and looks like the answer, because for anyone who
        has played before it is the answer. Making a returning player pick their
        story and chapter again every evening is a toll on the way back in.

        It is absent for a first-time player rather than disabled: an empty
        Continue button is a promise the game cannot keep yet.
      -->
      <button v-if="spot" class="resume" @click="$emit('resume', spot)">
        <span class="resume-label">Continue</span>
        <span class="resume-where">{{ spot.chapterTitle || spot.storyTitle }}</span>
        <span v-if="spot.chapterTitle" class="resume-sub">{{ spot.storyTitle }}</span>
      </button>

      <nav class="cards">
        <button class="card" :class="{ lead: !spot }" @click="$emit('go', 'play')">
          <h2>Play</h2>
          <p>Stories made of chapters, chapters made of levels. Come back whenever — progress is kept.</p>
        </button>

        <!--
          Speedrunning already worked, but it lived on a small button inside
          each story card, so nobody who was not already looking for it ever
          found it. A whole way of playing deserves to be visible from the
          front door.
        -->
        <button class="card" @click="$emit('go', 'speedrun')">
          <h2>Speedrun</h2>
          <p>One unbroken attempt against the clock — any% or 100%. Every run is recorded and can be watched back.</p>
        </button>

        <button class="card" @click="$emit('go', 'create')">
          <h2>Create</h2>
          <p>Draw terrain, wire up contraptions, lay out a chapter map. Share the result as a file.</p>
        </button>

        <!--
          Signing in is a menu item like the rest, not something tucked into a
          settings screen. It is a thing you might come here to do; the frame
          cap is not, which is why only the frame cap moved.
        -->
        <button v-if="canSignIn" class="card" :disabled="busy" @click="signIn">
          <h2>{{ busy ? 'Signing in…' : 'Sign in' }}</h2>
          <p>Keep your stories and progress across devices. Everything works without it.</p>
        </button>

        <!--
          Google's own button, shown only when One Tap refused to appear. It
          does not match the cards, and that is the trade: an out-of-place
          button beats no way in.
        -->
        <div v-show="needsFallback" ref="fallbackHost" class="fallback" />

        <!--
          Only for people with an account, because that is the only place
          awards exist. Offering it to a signed-out visitor would be a menu item
          that answers "sign in first".
        -->
        <button v-if="session.status === 'signed-in'" class="card" @click="$emit('go', 'awards')">
          <h2>Achievements</h2>
          <p>What you have earned for playing, racing and building — and how you stand against everyone.</p>
        </button>

        <button class="card quiet" @click="$emit('go', 'settings')">
          <h2>Settings</h2>
          <p>Frame rate.</p>
        </button>
      </nav>

      <p v-if="session.error" class="err">{{ session.error }}</p>
    </div>
  </div>
</template>

<script setup>
import WorldCanvas from '../components/WorldCanvas.vue'
import AccountBadge from '../components/AccountBadge.vue'
import { computed, nextTick, onMounted, ref } from 'vue'
import demo from '../levels/menu.json' // the menu background is an ordinary level
import { lastSpot } from '../core/recent.js'
import { chapter as getChapter, story as getStory } from '../core/library.js'
import { promptSignIn, refresh, renderSignInButton, session } from '../core/session.js'

defineEmits(['go', 'resume'])

const busy = ref(false)
const needsFallback = ref(false)
const fallbackHost = ref(null)

onMounted(refresh)

// Absent, not disabled, when there is no account to sign into: with no client
// id configured the game simply has no cloud, and offering a button that
// cannot work is worse than offering nothing.
const canSignIn = computed(
  () => session.status === 'anonymous' || session.status === 'loading' || session.status === 'unknown',
)

async function signIn() {
  busy.value = true
  session.error = null

  try {
    const shown = await promptSignIn()

    if (!shown) {
      needsFallback.value = true
      await nextTick()

      if (fallbackHost.value) {
        fallbackHost.value.replaceChildren()
        await renderSignInButton(fallbackHost.value)
      }
    }
  } catch (e) {
    session.error = e.message
  } finally {
    busy.value = false
  }
}

// Resolved against the library each time the menu opens, so a bookmark left
// pointing at a story that has since been deleted simply does not appear,
// rather than offering to continue into nothing.
const spot = computed(() => {
  const saved = lastSpot()
  if (!saved) return null

  const story = getStory(saved.storyId)
  if (!story) return null

  const chapter = saved.chapterId ? getChapter(saved.chapterId) : null

  return {
    storyId: story.id,
    storyTitle: story.title,
    chapterId: chapter?.id || null,
    chapterTitle: chapter?.title || null,
  }
})
</script>

<style scoped>
.menu { position: absolute; inset: 0; overflow: hidden; }
.bg { position: absolute; inset: 0; }
.badge { position: absolute; top: 14px; right: 16px; z-index: 3; }
.veil {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(100deg, var(--ink) 0%, rgba(11, 16, 20, 0.92) 32%, rgba(11, 16, 20, 0) 62%);
}
.content {
  position: relative; height: 100%;
  display: flex; flex-direction: column; justify-content: center;
  gap: 14px; padding: 0 clamp(24px, 7vw, 110px); max-width: 720px;
  pointer-events: none;
}
.content > * { pointer-events: auto; }
.eyebrow {
  font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.28em;
  text-transform: uppercase; color: var(--muted); margin: 0;
}
.title {
  font-family: var(--font-display); font-size: clamp(64px, 13vw, 140px);
  line-height: 0.82; margin: 0; letter-spacing: -0.03em; color: var(--text);
  text-shadow: 0 0 60px rgba(226, 112, 74, 0.25);
}
.title::after {
  content: ''; display: block; width: 96px; height: 6px; margin-top: 18px;
  background: var(--goo); border-radius: 3px;
}
.lede { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.6; max-width: 46ch; }

.resume {
  display: block; width: 100%; max-width: 430px; text-align: left;
  padding: 13px 18px; cursor: pointer; font: inherit; color: var(--text);
  background: linear-gradient(135deg, rgba(120, 180, 140, 0.22), rgba(60, 110, 90, 0.16));
  border: 1px solid rgba(140, 200, 160, 0.42); border-radius: 14px;
  transition: border-color 0.15s, transform 0.15s;
}
.resume:hover { border-color: rgba(170, 225, 190, 0.75); transform: translateY(-1px); }
.resume-label {
  display: block; font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.14em; text-transform: uppercase; color: #a8dcb8;
}
.resume-where { display: block; font-family: var(--font-display); font-size: 21px; margin-top: 2px; }
.resume-sub { display: block; font-size: 12px; color: var(--muted); margin-top: 1px; }

.cards { display: flex; flex-direction: column; gap: 8px; max-width: 430px; }
.card {
  text-align: left; padding: 12px 18px; cursor: pointer; font: inherit; color: var(--text);
  background: rgba(16, 26, 32, 0.72); border: 1px solid var(--line); border-radius: 12px;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.card:hover {
  border-color: rgba(160, 190, 210, 0.5); background: rgba(22, 36, 44, 0.85);
  transform: translateY(-1px);
}
.card h2 { margin: 0; font-family: var(--font-display); font-size: 19px; }
.card p { margin: 3px 0 0; font-size: 12px; line-height: 1.45; color: var(--muted); }

.card[disabled] { opacity: 0.6; cursor: default; }
.fallback { max-width: 430px; display: flex; justify-content: flex-start; }
.err { max-width: 430px; margin: 0; font-size: 12px; color: #e0736b; }

/* Settings is present but not competing: same shape, less contrast. */
.card.quiet { background: rgba(16, 26, 32, 0.5); }
.card.quiet h2 { font-size: 16px; color: var(--muted); }
.card.quiet:hover h2 { color: var(--text); }

/* With nothing to continue, Play carries the weight of the first click. */
.card.lead {
  background: linear-gradient(135deg, rgba(120, 180, 140, 0.2), rgba(60, 110, 90, 0.14));
  border-color: rgba(140, 200, 160, 0.42);
}
.card.lead:hover { border-color: rgba(170, 225, 190, 0.75); }

@media (max-width: 720px) {
  .veil { background: linear-gradient(180deg, var(--ink) 30%, rgba(11, 16, 20, 0.75) 100%); }
}
</style>
