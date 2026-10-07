"use client";

import type { Database } from "@chara-pinnacle/db-types";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { selectClassName } from "@/components/forms/select-class";
import { applicationStageOptions, isApplicationStatus } from "@/lib/applications/presentation";

// basePath is the address of the list with everything but the stage and the page (it may carry a query).
type StageFilterProps = { basePath: string; stage: Database["public"]["Enums"]["application_status"] | null };

// The address is the state of the list: choosing a stage writes it to the address and shows the first page of that stage.
export function StageFilter({ basePath, stage }: StageFilterProps) {
  const router = useRouter();
  const id = useId();

  return (
    <div className="grid gap-2 sm:max-w-xs">
      <label htmlFor={id} className="text-sm leading-snug font-medium">
        Filter by stage
      </label>
      <select
        id={id}
        key={stage ?? "all"}
        defaultValue={stage ?? ""}
        className={selectClassName}
        onChange={(event) => {
          const value = event.currentTarget.value;
          router.push(isApplicationStatus(value) ? `${basePath}${basePath.includes("?") ? "&" : "?"}stage=${value}` : basePath);
        }}
      >
        <option value="">All stages</option>
        {applicationStageOptions.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
