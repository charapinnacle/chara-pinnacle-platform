"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock, Mail } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveNotificationSettings } from "@/lib/actions/notifications";
import { notificationSettingsSchema, type NotificationSettings } from "@/lib/validation/notifications";

const GROUP_ID = "notification-delivery";

const options = [
  { value: "immediate", label: "Immediately", icon: Mail },
  { value: "daily_summary", label: "Daily summary", icon: CalendarClock },
] as const;

export function NotificationForm({ delivery }: { delivery: NotificationSettings["delivery"] }) {
  const form = useForm<NotificationSettings>({
    resolver: zodResolver(notificationSettingsSchema),
    defaultValues: { delivery },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The settings were not saved", clearOnFailure: "delivery" });
  const error = formState.errors.delivery?.message;

  function save(values: NotificationSettings) {
    return submit(
      () => saveNotificationSettings(values),
      (result) => {
        if (result.done) {
          reset(values);
          toast({ title: "Notification settings saved" });
        } else if (result.message) {
          toast({ variant: "error", title: "The settings were not saved", description: result.message });
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(save)}>
      <ErrorSummary
        ref={summaryRef}
        items={error ? [{ key: "delivery", message: error, targetId: GROUP_ID }] : []}
        onSelect={() => form.setFocus("delivery")}
      />
      <RadioGroupField
        control={control}
        name="delivery"
        id={GROUP_ID}
        legend="Emails about new applications"
        description="Immediately: one email for each new application. Daily summary: one email a day at 08:00 Central European time, only when there are new applications."
        options={options}
      />
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Save
        </FormButton>
      </div>
    </form>
  );
}
