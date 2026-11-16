// Shown instantly inside the project shell (sidebar stays) while a tab's server data loads.
export default function Loading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <div className="route-loading-head">
        <span className="spinner" aria-hidden="true" />
        <span>در حال بارگذاری...</span>
      </div>
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk sk-block" />
      <div className="sk sk-block" />
    </div>
  );
}
