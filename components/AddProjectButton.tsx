"use client";
// Ported from public/app.js's openAddProject(): a native <dialog> (styled by .modal /
// dialog::backdrop in globals.css) holding ProjectForm in create mode.
import { useRef } from "react";
import { ProjectForm } from "./ProjectForm";
import Icon from "./Icon";

export function AddProjectButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="btn primary sm" onClick={() => dialogRef.current?.showModal()}>
        <Icon name="plus" />افزودن پروژه
      </button>
      <dialog ref={dialogRef} className="modal wide">
        <div className="modal-pad">
          <ProjectForm onDone={() => dialogRef.current?.close()} />
        </div>
      </dialog>
    </>
  );
}
