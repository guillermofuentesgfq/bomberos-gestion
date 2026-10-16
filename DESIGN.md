# DESIGN.md

Dirección visual y contrato de tokens de **bomberos-gestion**. Deriva de
[`design-system/bomberos-gestion/MASTER.md`](design-system/bomberos-gestion/MASTER.md)
y del contexto de producto de [`PRODUCT.md`](PRODUCT.md). Es la referencia que
las dos superficies (panel administrativo y sitio público) deben respetar.

> Si una página tiene un archivo propio en
> `design-system/bomberos-gestion/pages/[pagina].md`, ese archivo **reemplaza**
> el Master para esa página. Este documento describe el acuerdo global.

---

## 1. Dirección visual

**Estilo:** *Accessible & Ethical* — interfaz inclusiva, alto contraste, texto
grande (16 px+), navegación por teclado, estados de foco visibles y semántica
clara.

**Por qué:** el producto sirve a instituciones públicas, a voluntarios sin
perfil técnico y a la ciudadanía. La accesibilidad no es una capa decorativa,
es el requisito. Está pensado para **gobierno, salud, educación y servicio
público**.

**Principios visuales**

1. **Sobriedad institucional.** Sin gradientes morados, sin cristal (glassmorphism),
   sin sombras dramáticas. La interfaz no compite con el escudo ni la identidad del cuerpo.
2. **Precisión sobre expresividad.** En el panel, la jerarquía la crean el spacing
   y la tipografía, no el color ni el movimiento.
3. **Dos densidades con un solo sistema.** El panel es denso; el sitio público es
   espacioso. Comparten tokens, tipografía y reglas de contraste.
4. **Configurable por institución.** El color es un token, no una constante.
5. **Reaprendible.** Un usuario que vuelve después de meses entiende dónde está sin ayuda.

**Anti-patrones prohibidos:** diseño recargado/ornamentado, bajo contraste,
movimiento decorativo, gradientes AI púrpura/rosa, emojis como iconos, hex
hardcodeados en componentes, foco invisible.

---

## 2. Color

La paleta del Master es **una referencia sobria y accesible**, no una identidad
fija. En producción, cada institución define sus colores **en tiempo de
ejecución**. Los valores de respaldo viven en `src/web/index.css`:

```css
:root {
  --brand-primary:   #b91c1c; /* respaldo: rojo institucional */
  --brand-secondary: #111827;
  --surface:         #ffffff;
  --surface-muted:   #f8fafc;
  --text:            #0f172a;
  --text-muted:      #475569;
  --border:          #e2e8f0;
}
```

**Roles semánticos (contrato).** Los componentes consumen **siempre** estos
tokens; la institución puede reemplazar los dos primeros sin tocar componentes.

| Rol | Token | Referencia Master | Uso |
|---|---|---|---|
| Marca primaria | `--brand-primary` | `#0F172A` (navy) / respaldo rojo `#b91c1c` | Encabezados institucionales, acento de marca, nav del sitio |
| Marca secundaria | `--brand-secondary` | `#334155` | Superficies y bloques institucionales secundarios |
| Acento / CTA | `--color-accent` | `#0369A1` (azul) | Acción principal, enlaces, botón primario |
| Superficie | `--surface` | `#FFFFFF` | Fondo de tarjetas y modales |
| Superficie atenuada | `--surface-muted` | `#F8FAFC` | Fondo de página, filas alternas, zonas inactivas |
| Texto | `--text` | `#020617` | Texto principal |
| Texto atenuado | `--text-muted` | `#475569` | Metadatos, ayudas, texto secundario |
| Borde | `--border` | `#E2E8F0` | Separadores, bordes de inputs y tarjetas |
| Destructivo | `--color-destructive` | `#DC2626` | Bajas, eliminación, errores |
| Anillo de foco | `--color-ring` | `#0F172A` | `outline`/`box-shadow` de foco visible |

**Estados de dominio** (panel de inventario): usar familias accesibles y
consistentes — *disponible* (verde), *asignado* (azul), *mantenimiento*
(ámbar), *baja* (rojo). El color **nunca** es el único indicador: siempre va
acompañado de etiqueta o icono.

**Contraste (AA obligatorio).**

- Texto normal ≥ **4.5:1** sobre su fondo real.
- Texto grande (≥ 24 px, o ≥ 19 px en negrita) ≥ **3:1**.
- Contornos de controles, iconos con significado y bordes de foco ≥ **3:1**.
- Verificar **modo claro y oscuro por separado**; no inferir uno del otro.
- La paleta de respaldo (`#b91c1c` sobre `#ffffff`, `#0F172A` sobre `#F8FAFC`)
  cumple AA. Toda institución que cambie `--brand-primary` debe revalidar
  contraste del texto sobre ese color.

**Modo oscuro.** Soportado por tokens, no por reglas ad-hoc. `prefers-color-scheme`
ya reasigna `--surface`, `--text`, `--border`. Ningún componente define colores
propios por tema.

---

## 3. Tipografía

**Familia:** **Atkinson Hyperlegible** (encabezados y cuerpo). Diseñada por el
Braille Institute para máxima legibilidad; ideal para servicio público,
contraste y dislexia.

- Pesos: `400` (cuerpo), `700` (encabezados y énfasis). Sin más pesos.
- **Autoalojar la fuente** en `public/` y servirla desde el mismo origen; no
  depender del CDN de Google Fonts (el producto es autodesplegable y no debe
  requerir servicios externos obligatorios).
- Fallback del sistema mientras carga, sin salto de layout:
  `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`.

**Mapeo Tailwind v4** (`src/web/index.css`):

```css
@theme {
  --font-sans: 'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif;
  --font-sans--font-feature-settings: 'tnum'; /* cifras tabulares en tablas */
}
```

**Escala** (rem, 1rem = 16 px). Base mínima 16 px, sin excepciones:

| Token | Tamaño | Uso |
|---|---|---|
| `--text-xs` | 0.75rem / 12px | Etiquetas de estado, marcas |
| `--text-sm` | 0.875rem / 14px | Metadatos en tablas densas |
| `--text-base` | 1rem / 16px | Cuerpo, inputs, celdas de tabla |
| `--text-lg` | 1.125rem / 18px | Subtítulos de sección |
| `--text-xl` | 1.25rem / 20px | Títulos de tarjeta |
| `--text-2xl` | 1.5rem / 24px | Títulos de página (panel) |
| `--text-3xl` | 1.875rem / 30px | Encabezado de sección (sitio) |
| `--text-4xl` | 2.25rem / 36px | Hero móvil |
| `--text-5xl` | 3rem / 48px | Hero escritorio (sitio) |

- Interlineado: cuerpo **1.5**, títulos **1.2**.
- Ancho de medida: **60–75 caracteres** en texto largo; nada de párrafos de
  borde a borde en pantallas grandes.

---

## 4. Espaciado (density 8/10 · denso)

Escala base 4 px. El panel usa los tramos bajos; el sitio público los altos.

| Token | Valor | Uso |
|---|---|---|
| `--space-xs` | 2px / 0.125rem | Separaciones finas, badges |
| `--space-sm` | 4px / 0.25rem | Huecos entre icono y texto |
| `--space-md` | 8px / 0.5rem | Padding estándar de control |
| `--space-lg` | 12px / 0.75rem | Padding de celda/tarjeta compacta |
| `--space-xl` | 16px / 1rem | Gaps de layout, padding de tarjeta |
| `--space-2xl` | 24px / 1.5rem | Márgenes de sección (panel) |
| `--space-3xl` | 32px / 2rem | Padding de hero (panel) |
| `--space-4xl` | 48px / 3rem | Sección (sitio público) |
| `--space-5xl` | 64px / 4rem | Bloques del sitio público |
| `--space-6xl` | 96px / 6rem | Hero del sitio público |

Ritmo vertical por jerarquía: mismo nivel → mismo espaciado. El panel no sube de
`--space-2xl` entre bloques relacionados.

---

## 5. Radios

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 6px | Chips, badges, inputs pequeños |
| `--radius-md` | 8px | Botones, inputs |
| `--radius-card` | 12px | Tarjetas, paneles, celdas destacadas |
| `--radius-lg` | 16px | Modales, hojas, diálogos |

```css
@theme {
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-card: 0.75rem; /* 12px — ya definido en src/web/index.css */
  --radius-lg: 16px;
}
```

---

## 6. Sombras

Discretas y funcionales; comunican elevación, no espectáculo.

| Token | Valor | Uso |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Elevación sutil, inputs enfocados |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Tarjetas, botones elevados |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Menús, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Modales |

En modo oscuro, sustituir por bordes `--border` más visibles; una sombra negra
sobre fondo oscuro no aporta jerarquía.

---

## 7. Movimiento (motion 3/10 · sutil)

El movimiento es **explicativo**, no decorativo.

- Transiciones de estado (hover, foco, activo): **150–300 ms**, `ease-out`.
- Aparición de contenido al hacer scroll (sitio público): **300–400 ms**,
  `power1.out`, desplazamiento vertical pequeño (8–16 px) — se lee como
  _fade_, no como _slide_.
- **Nada** de animación en datos del panel que pueda distraer o ralentizar.
- Sin transformaciones que cambien el tamaño del layout en hover.
- **`prefers-reduced-motion: reduce` obligatorio:** desactivar todo movimiento
  no esencial y renderizar el estado final de inmediato.
- El contenido crítico para SEO **no** debe depender de una animación para
  volverse visible (fallback sin JS).

---

## 8. Foco y estados

- **Foco visible siempre**, nunca `outline: none` sin sustituto.
  ```css
  :focus-visible {
    outline: 3px solid var(--color-ring);
    outline-offset: 2px;
    border-radius: inherit;
  }
  ```
- Orden de foco = orden visual. Enlace "saltar al contenido" en el panel y en el sitio.
- Estados de control: `default`, `hover`, `focus-visible`, `active`, `disabled`,
  `loading` — los seis definidos para cada control, también en modo oscuro.
- `disabled`: atenuado, sin acción, con semántica `disabled`.
- Objetivos táctiles ≥ **44×44 px** (móvil) con área sensible ampliada cuando el
  icono es menor.
- `cursor: pointer` en todo elemento clicable.
- Errores de formulario: mensaje inline junto al campo y resumen enlazado al
  enviar varios errores.

---

## 9. Componentes: valores de referencia

Tomados de `MASTER.md` y usados como contrato mínimo.

| Componente | Radio | Padding | Detalle |
|---|---|---|---|
| Botón primario | `--radius-md` | 12px 24px | Fondo `--color-accent`, texto blanco AA; hover sin cambio de tamaño |
| Botón secundario | `--radius-md` | 12px 24px | Borde 2px `--brand-primary`, fondo transparente |
| Botón destructivo | `--radius-md` | 12px 24px | Fondo `--color-destructive`, texto blanco; solo en bajas/eliminación |
| Tarjeta | `--radius-card` | `--space-xl` | Superficie `--surface`, borde `--border`, `--shadow-md` |
| Input | `--radius-md` | 12px 16px | Borde `--border`; foco con anillo visible |
| Modal | `--radius-lg` | `--space-3xl` | Overlay oscurecido medido sobre el fondo real; ancho máx. ~500px |
| Tabla de inventario | `--radius-card` | `--space-md` celda | Cifras tabulares, filas alternas `--surface-muted`, cabecera fija |

---

## 10. Checklist de entrega

- [ ] Sin emojis como iconos; set de iconos SVG consistente (Heroicons/Lucide).
- [ ] `cursor-pointer` en todo elemento clicable.
- [ ] Hover y foco con transición 150–300 ms, sin desplazamiento de layout.
- [ ] Contraste AA verificado en **claro y oscuro**.
- [ ] Foco visible para navegación por teclado; enlace "saltar al contenido".
- [ ] `prefers-reduced-motion` respetado.
- [ ] Objetivos táctiles ≥ 44×44 px.
- [ ] Responsive verificado en 375, 768, 1024 y 1440 px.
- [ ] Sin scroll horizontal en móvil; nada oculto tras barras fijas.
- [ ] Ningún hex hardcodeado en componentes: todo vía tokens.
- [ ] Colores de marca tomados de `--brand-primary` / `--brand-secondary`.
