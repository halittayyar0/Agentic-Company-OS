# Keeper mascots

The ten Keepers are Agentic Company OS's built-in agent identities. They make a
team recognizable without suggesting that a fictional portrait is a real
employee. They appear where an agent identity helps navigation; task state still
comes from the backend and is never inferred from a mascot.

The atlas is a 5-column by 2-row sprite sheet. In reading order its roles are
leader, marketing, sales, operations, finance, product, engineering, research,
support, and content. The specialist templates reuse the closest role: design
uses product, quality uses operations, data uses research, and automation uses
engineering. Custom agents receive a stable sprite from their ID. A user-uploaded
image continues to override the built-in mascot and can be reset in the profile.

The family uses an ink-navy shell (`#192334`), off-white face (`#F5F7FA`), a
single cobalt signal (`#1A5BBC`), and occasional small sage or amber marks.
Each character has the same scale, view, line weight and two-eye face, with a
different silhouette for its role. The colorful edition adds cobalt, coral,
amber, jade, teal, lavender, sky, violet, rose and tangerine role accents and small
friendly smiles. The colors distinguish characters; they do not encode task
success. Status still has a readable label.

## Live motion and conversation

The built-in mascot gently breathes while idle, bobs while its latest reported
state is working, and tilts while blocked. An archived or unconfirmed profile is
still. Selecting the profile mascot or **Let's talk** opens the existing direct
chat and focuses its composer; it never sends a message, changes the draft,
creates a task, or changes permissions. The short greeting is visual feedback.
The companion's supportive copy is interface guidance, not an AI-generated reply
or a claim that the fictional character has feelings. The chat remains an AI
expert conversation.

**Pause mascot motion** is available in the top toolbar on every workspace
page. The same control appears in the expert profile. It applies to all Keepers,
survives reload in this browser, and synchronizes across tabs. With browser
storage unavailable the control still works for the current tab. Device reduced
motion overrides the live preference. Hidden documents and offscreen sprites
pause their animation; custom uploaded portraits stay still. Motion uses CSS
transforms, not timers per frame, an animation library, or model calls.

The atlas was generated specifically for this repository with the built-in
ImageGen tool from a prompt for ten original, nonhuman, vector-like workspace
and signal-beacon characters in a strict 5 × 2 grid. The prompt excluded text,
logos, human portraits, gradients, and resemblance to existing mascots. The
generated PNG was encoded to WebP with FFmpeg at quality 80; no third-party art
was used. The committed WebPs and SVG favicon are project-owned assets under the
repository's MIT license. `company-keeper-color-atlas.webp` is the source of
truth for the shipped UI (76,668 bytes). The original atlas remains the source
reference for the color edit, not an additional downloaded UI asset.

## Generation prompt

The color edition was edited with the built-in ImageGen tool using the original
atlas as its sole reference. Its prompt preserved the ten identities and exact
grid, added role colors in reading order (cobalt, coral, amber, jade, teal,
lavender, sky, violet, rose, tangerine), and added small friendly smiles. It
required off-white faces, ink contours, bold flat shapes readable at 32 px and
no extra characters, gradients, text, labels, logos or resemblance to existing
company mascots. The original generation prompt is retained below.

```text
Create a finished, original mascot sprite atlas for the open-source self-hosted web app 'Agentic Company OS'. Wide 2:1 image, a precise 5-column by 2-row grid of ten equal portrait cells, with no dividing lines, text, labels, logos, or watermarks. Each cell contains exactly one fully visible small nonhuman 'Keeper' character, centered at identical scale with a generous safe margin so it can be cropped into a tiny rounded avatar. The Keepers are a cohesive new species: compact friendly rounded architectural forms inspired by a calm workspace and a signal beacon, off-white porcelain-like faceplate, deep ink-navy outer shell, one crisp cobalt-blue horizontal signal mark, two small expressive eyes, short subtle feet. Distinctive silhouette, restrained editorial 2D vector illustration, precise bold shapes and minimal details that remain recognizable at 32 pixels. Ten visibly different personalities and role cues through silhouette only, in row-major order: leader with calm arched crown, marketing with a soft broadcast fan, sales with forward fin, operations with balanced side tabs, finance with ledger notch, product with layered panel, engineering with squared antenna, research with circular lens, support with gently open side wings, content with speech-bracket crown. Same lighting, size, line weight, palette, and viewpoint in every cell. Palette: navy #192334, cobalt #1A5BBC, soft off-white #F5F7FA, tiny restrained accents in sage or warm amber only where needed. Cell background uniformly #F5F7FA. Sophisticated and warm, credible in a professional operations app, no human portraits, no generic robot heads, no neon, no gradients, no 3D rendering, no copies of or resemblance to any existing company's mascot. Export as a clean raster atlas with accurate equal grid alignment.
```
