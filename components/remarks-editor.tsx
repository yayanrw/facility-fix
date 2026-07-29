"use client";

import { useState } from "react";
import {
  BtnBold,
  BtnBulletList,
  BtnItalic,
  BtnLink,
  BtnNumberedList,
  BtnUnderline,
  Editor,
  EditorProvider,
  Separator as EditorSeparator,
  Toolbar,
} from "react-simple-wysiwyg";

import { cn } from "@/lib/utils";

/**
 * The only non-shadcn UI component in the app — shadcn ships no rich text
 * editor. Wrapped here so the border, radius, and focus ring come from the
 * same tokens as `Textarea`, and so swapping editors later touches one file.
 *
 * The value rides along in a hidden input, so the surrounding <form> submits
 * it to a Server Action with no client state plumbing. Whatever HTML arrives
 * is re-sanitized on the server (lib/sanitize.ts) — this editor is a
 * convenience, never a trust boundary.
 */
export function RemarksEditor({
  name,
  defaultValue = "",
  placeholder,
  required,
  className,
  onValueChange,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  onValueChange?: (html: string) => void;
}) {
  const [html, setHtml] = useState(defaultValue);

  return (
    <div
      // Border, radius, and focus ring match `Textarea`. The editor internals
      // are themed in globals.css — Tailwind utilities cannot reach them, see
      // the comment on the `.rsw-*` block there.
      className={cn(
        "remarks-editor",
        "overflow-hidden rounded-lg border border-input bg-transparent text-base transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm dark:bg-input/30",
        className
      )}
    >
      <input type="hidden" name={name} value={html} required={required} />
      <EditorProvider>
        <Editor
          value={html}
          placeholder={placeholder}
          onChange={(e) => {
            setHtml(e.target.value);
            onValueChange?.(e.target.value);
          }}
        >
          <Toolbar>
            <BtnBold />
            <BtnItalic />
            <BtnUnderline />
            <EditorSeparator />
            <BtnBulletList />
            <BtnNumberedList />
            <EditorSeparator />
            <BtnLink />
          </Toolbar>
        </Editor>
      </EditorProvider>
    </div>
  );
}
