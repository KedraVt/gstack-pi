---
name: manim-video
description: Build reusable Manim explainers for technical concepts, graphs, system diagrams, and product walkthroughs, then hand off to a wider video-production stack if needed. Use when the user wants a clean animated explainer rather than a generic talking-head script.
---

# Manim Video Production Pipeline

Use Manim Community Edition for technical explainers, math animations, algorithm visualizations, and system diagrams where motion, structure, and clarity matter more than photorealism.

## When to Activate

- The user wants a technical explainer animation (3Blue1Brown style).
- The concept is a graph, network, workflow, system architecture, or metric progression.
- The user wants a step-by-step mathematical derivation, equation proof, or algorithm walkthrough.
- The visual should feel precise, educational, and clean rather than generically cinematic.

## Prerequisites & Stack

- **Python 3.10+** and **Manim Community Edition v0.20+** (`pip install manim`)
- **LaTeX** (texlive-full/MiKTeX) for rendering mathematical symbols/equations
- **ffmpeg** for video stitching, format conversion, and audio muxing
- **video-editing** / **remotion-video-creation** for compositing, captions, or additional motion layers

## Creative & Visual Standards

### 1. Educational Cinema
- **Narrative Arc**: Before coding, define the visual thesis. What misconception does this correct? What is the "aha moment"?
- **Geometry before Algebra**: Show the visual shape first, the equation second.
- **Breathing Room**: Add `self.wait()` after key reveals (typically 1.5s - 3.0s). Do not rush.
- **Opacity Layering**: Direct attention using layers:
  - Primary elements: `opacity = 1.0`
  - Contextual elements: `opacity = 0.4`
  - Structural elements (axes/grids): `opacity = 0.15`

### 2. Scene Planning Rules
- Break the concept into 3 to 6 scenes.
- Each scene must prove one thing. Avoid overstuffed screens.
- Prefer progressive reveal over full-screen clutter.
- Use motion to explain state change, not just to keep the screen busy.

### 3. Visual Design Tokens

#### Color Palettes
| Palette | Background | Primary | Secondary | Accent | Use Case |
| --- | --- | --- | --- | --- | --- |
| **Classic 3B1B** | `#1C1C1C` | `#58C4DD` (BLUE) | `#83C167` (GREEN) | `#FFFF00` (YELLOW) | Math, general CS |
| **Warm Academic** | `#2D2B55` | `#FF6B6B` | `#FFD93D` | `#6BCB77` | Approachable concepts |
| **Neon Tech** | `#0A0A0A` | `#00F5FF` | `#FF00FF` | `#39FF14` | Systems, architecture |
| **Monochrome** | `#1A1A2E` | `#EAEAEA` | `#888888` | `#FFFFFF` | Minimalist design |

#### Typography Scale
- **Use Monospace Fonts** (e.g. `Menlo`, `Courier`) to avoid Pango kerning issues in Manim.
- Minimum `font_size=18` for legibility.

| Role | Font Size | Usage |
| --- | --- | --- |
| **Title** | 48 | Scene titles, opening cards |
| **Heading** | 36 | Section headers within a scene |
| **Body** | 30 | Explanatory text blocks |
| **Label** | 24 | Annotations, axis labels |
| **Caption** | 20 | Subtitles, fine print |

#### Animation Speed Guide
| Context | run_time | self.wait() after |
| --- | --- | --- |
| Title/Intro appear | 1.5s | 1.0s |
| Key equation reveal | 2.0s | 2.0s |
| Transform/morph | 1.5s | 1.5s |
| Supporting label | 0.8s | 0.5s |
| FadeOut cleanup | 0.5s | 0.3s |
| "Aha moment" reveal | 2.5s | 3.0s |

---

## Technical & Render Conventions

### 1. Code Guidelines
- **Raw Strings for LaTeX**: Always use `r"..."` for math expressions (e.g., `MathTex(r"\frac{1}{2}")`).
- **Edge Buffer**: Maintain `buff >= 0.5` for edge positioning (e.g., `label.to_edge(DOWN, buff=0.5)`).
- **FadeOut Before Replacing**: Avoid writing text directly on top of old text. Use `ReplacementTransform` or `FadeOut` old text first.
- **Animate Added Mobjects Only**: Do not call `.animate` on mobjects that have not been introduced to the scene.
- **Scene Setup**: Define `self.camera.background_color` in every scene class.
- **Clean Exits**: FadeOut all mobjects at the end of each scene using `self.play(FadeOut(Group(*self.mobjects)))` or similar.

### 2. Rendering Presets
- Default to **16:9 landscape** unless vertical is explicitly requested.
- Always iterate at Low Quality (`-ql`) for smoke tests. Only render High Quality (`-qh`) for the final delivery.

| Quality | Command Flag | Resolution | FPS | Render Speed |
| --- | --- | --- | --- | --- |
| **Draft** | `-ql` | 854x480 | 15 | 5-15s / scene |
| **Medium** | `-qm` | 1280x720 | 30 | 15-60s / scene |
| **Production** | `-qh` | 1920x1080 | 60 | 30-120s / scene |

---

## Default Network Graph Layout
For social-graph and network-optimization explainers:
- Use [assets/network_graph_scene.py](assets/network_graph_scene.py) as a reusable starter.
- Show the unoptimized graph before showing the optimized/pruned graph.
- Distinguish low-signal follow clutter from high-signal bridges.
- Highlight warm-path nodes and target clusters.

---

## Production Pipeline Workflow

1. **PLAN (`plan.md`)**: Define the visual thesis, storyboard (3-6 scenes), visual elements, color palette, and optional narration script.
2. **CODE (`script.py`)**: Write code using **one class per scene** to ensure they are independently testable and renderable.
3. **RENDER**: Draft render using `manim -ql script.py Scene1 Scene2`.
4. **STITCH**: Combine the rendered scene clips into `final.mp4` using ffmpeg concat:
   ```bash
   cat > concat.txt << 'EOF'
   file 'media/videos/script/480p15/Scene1.mp4'
   file 'media/videos/script/480p15/Scene2.mp4'
   EOF
   ffmpeg -y -f concat -safe 0 -i concat.txt -c copy final.mp4
   ```
5. **REVIEW**: Generate preview stills using `manim -ql --format=png -s script.py Scene1`.

---

## Creative Divergence & Reversal Techniques
If the user requests unconventional, creative, or experimental styles, use these strategies:
- **SCAMPER**:
  - *Substitute*: Replace standard visual metaphors (e.g. matrices -> city grids).
  - *Combine*: Merge algebraic formulas and geometric transformations simultaneously.
  - *Reverse*: Show the final optimized layout first, then deconstruct it.
  - *Modify*: Exaggerate parameters (e.g., 100x learning rate) to show effects.
  - *Eliminate*: Remove symbols and explain purely via motion and spatial relationships.
- **Assumption Reversal**: List the standard visual presentation (e.g. left-to-right, 2D discrete) and invert it (e.g. 3D embedding, continuous morphing, right-to-left flow).

---

## Reference Material Directory
If a `references/` directory ships with this skill, consult these guides when present:
- `references/animations.md` — Rate functions, timing patterns, `.animate` syntax.
- `references/mobjects.md` — Text, shapes, VGroup/Group layout.
- `references/visual-design.md` — Opacity layering, layout templates.
- `references/equations.md` — LaTeX formulas, derivations, morphing math.
- `references/graphs-and-data.md` — Axes, bar charts, animated dataset plots.
- `references/camera-and-3d.md` — ThreeDScene camera movement, parametric surfaces.
- `references/scene-planning.md` — Storyboard template, scene planning.
- `references/rendering.md` — CLI options, quality presets, ffmpeg stitching.
- `references/troubleshooting.md` — Handling common LaTeX/Manim errors.
