# Desmos Equation Editor

An interactive drawing editor that converts hand-drawn shapes into Desmos mathematical equations. Draw like Adobe Illustrator, export like Desmos.

**Created by nanon dev & mimo opencode**

## Features

- **Illustrator-like Drawing Tools**: Pen, Line, Rectangle, Ellipse, Select, Pan, Zoom
- **Snap to Grid**: Toggle snap mode for clean, mathematical lines
- **Auto Equation Conversion**: Automatically converts drawn shapes to LaTeX math equations
- **Desmos Integration**: Export directly to Desmos calculator
- **LaTeX Export**: Copy equations as LaTeX code
- **SVG Export**: Download your drawings as SVG files
- **Quick Shapes**: Pre-built sine, cosine, parabola, and geometric shapes
- **Layer Management**: Organize, show/hide, reorder your shapes
- **Undo/Redo**: Full history support with Ctrl+Z / Ctrl+Y
- **Auto-Save**: Projects save automatically every 30 seconds
- **Bilingual**: Full English and Thai language support
- **Live Stats**: Track visitors, drawings, and exports
- **User Feedback**: Built-in feedback collection system
- **Keyboard Shortcuts**: Fast tool switching (P, L, R, O, V, H, etc.)
- **Touch Support**: Works on tablets and touch devices

## Live Demo

Visit: `https://YOUR_USERNAME.github.io/desmos-editor/`

## Deployment (GitHub Pages)

1. Create a new repository on GitHub named `desmos-editor`
2. Push this folder to the repo:
   ```bash
   cd desmos-editor
   git init
   git add .
   git commit -m "Initial commit - Desmos Equation Editor"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/desmos-editor.git
   git push -u origin main
   ```
3. Go to Settings > Pages
4. Set Source to "Deploy from a branch"
5. Select branch: `main`, folder: `/ (root)`
6. Click Save
7. Your site will be live at `https://YOUR_USERNAME.github.io/desmos-editor/`

## Keyboard Shortcuts

| Key | Tool |
|-----|------|
| `V` | Select |
| `P` | Pen |
| `L` | Line |
| `R` | Rectangle |
| `O` | Ellipse |
| `E` | Eraser |
| `H` | Pan |
| `G` | Toggle Grid |
| `S` | Toggle Snap |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save Project |
| `Delete` | Delete Selected |
| `Escape` | Deselect |
| Scroll | Zoom in/out |
| Middle Mouse | Pan |

## Equation Types

The editor automatically converts shapes to LaTeX:

- **Lines** → `y = mx + b`
- **Ellipses** → Standard ellipse equation
- **Rectangles** → Polygon coordinates
- **Freehand Paths** → Quadratic polynomial approximation or line segments

## Tech Stack

- Pure HTML5 Canvas + CSS3 + Vanilla JavaScript
- No frameworks, no build tools, no dependencies
- Google Fonts (Inter, JetBrains Mono)
- Desmos API (optional, for direct calculator integration)

## License

MIT License - Created by nanon dev & mimo opencode
