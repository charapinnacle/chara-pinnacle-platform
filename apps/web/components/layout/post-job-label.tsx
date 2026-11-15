// Buttons and header links are shown in Title Case by CSS capitalize, which would also raise the article: "Post A Job".
// One outer span keeps the words a single flex item, so the button's gap does not space them apart.
export function PostJobLabel() {
  return (
    <span>
      Post <span className="normal-case">a</span> Job
    </span>
  );
}
