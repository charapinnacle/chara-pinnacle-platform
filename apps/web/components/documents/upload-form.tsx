"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormField, InputField, controlClassName } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { Input } from "@/components/ui/input";
import { startDocumentUpload } from "@/lib/actions/documents";
import { formatFileSize } from "@/lib/documents/presentation";
import { createClient } from "@/lib/supabase/browser";
import {
  DOCUMENT_BUCKET,
  acceptedExtensions,
  documentTypeOptions,
  uploadFormSchema,
  type UploadFormInput,
} from "@/lib/validation/documents";

const emptyForm = { type: "", title: "", expiresOn: "" };
type Outcome = { errors?: Record<string, string>; message?: string; uploaded?: string };

const SEND_FAILED = "The file could not be sent. Delete the unfinished upload from the list and try again.";

type UploadFormProps = { onChanged: () => void; onUploaded: (documentId: string) => void };

// Metadata first, then the bytes: the Server Action creates the row and the signed upload URL, and the browser sends the
// file straight to Storage, so no file passes through a Next.js request.
export function UploadForm({ onChanged, onUploaded }: UploadFormProps) {
  const form = useForm<UploadFormInput>({ resolver: zodResolver(uploadFormSchema), defaultValues: emptyForm });
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not upload the document" });
  const [announcement, setAnnouncement] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const { control, formState } = form;
  const type = useWatch({ control, name: "type" });

  const onSubmit = form.handleSubmit(() =>
    submit(
      async (): Promise<Outcome> => {
        const { type: kind, title, expiresOn, file } = form.getValues();
        const ticket = await startDocumentUpload({
          type: kind,
          title,
          expiresOn,
          file: { name: file.name, size: file.size, type: file.type },
        });
        if (!ticket.upload) {
          onChanged();
          return ticket;
        }
        const { documentId, path, token } = ticket.upload;
        const { error } = await createClient()
          .storage.from(DOCUMENT_BUCKET)
          .uploadToSignedUrl(path, token, file, { contentType: file.type });
        onChanged();
        if (error) return { message: SEND_FAILED };
        onUploaded(documentId);
        return { uploaded: file.name };
      },
      (result) => {
        if (result.uploaded) {
          toast({ title: "Document uploaded" });
          setAnnouncement(`Uploaded ${result.uploaded}. We are checking the file.`);
          form.reset(emptyForm);
          setFileKey((key) => key + 1);
        } else if (result.message) {
          toast({ variant: "error", title: "Could not upload the document", description: result.message });
          setAnnouncement(result.message);
        }
      },
    ),
  );

  return (
    <form noValidate className="grid gap-5" onSubmit={onSubmit}>
      <SelectField control={control} name="type" label="Type" placeholder="Choose a type" options={documentTypeOptions} />
      <InputField control={control} name="title" label="Title" />
      {type === "certificate" ? (
        <InputField control={control} name="expiresOn" label="Expiry date (optional)" type="date" />
      ) : null}
      <FormField control={control} name="file" label="File" description="PDF, JPG or PNG, up to 15 MB.">
        {(field) => (
          <Input
            key={fileKey}
            type="file"
            id={field.id}
            name={field.name}
            ref={field.ref}
            accept={acceptedExtensions}
            aria-invalid={field["aria-invalid"]}
            aria-describedby={field["aria-describedby"]}
            className={`h-auto py-2.5 ${controlClassName}`}
            onBlur={field.onBlur}
            onChange={(event) => {
              const file = event.target.files?.[0];
              field.onChange(file);
              setAnnouncement(file ? `Selected file: ${file.name} (${formatFileSize(file.size)})` : "");
            }}
          />
        )}
      </FormField>
      <p aria-live="polite" className="min-h-6 text-body text-muted-foreground">
        {announcement}
      </p>
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Uploading..." : "Upload"}
      </FormButton>
    </form>
  );
}
