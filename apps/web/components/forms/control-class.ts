// The look of every text control (the height, h-12, is set where the control is used, as a file input is taller).
// Focus is the one 2 px accent outline of globals.css at a 2 px offset with the border turning near-black, so the
// primitive's own border and ring colours are cancelled here; the inset shadow keeps a browser autofill from tinting the field.
export const controlClassName =
  "rounded-control border-input bg-card px-4 text-base text-foreground transition-[border-color,background-color] duration-150 hover:border-muted-foreground focus-visible:border-foreground focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-0 aria-invalid:hover:border-destructive aria-invalid:focus-visible:border-destructive autofill:shadow-[inset_0_0_0_1000px_var(--color-card)] autofill:[-webkit-text-fill-color:var(--color-foreground)] md:text-base";
