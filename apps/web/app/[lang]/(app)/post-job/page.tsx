import { redirect } from "next/navigation";
import { getMyOrganizations, publishingOrganization } from "@/lib/dal/organizations";
import { requireUser } from "@/lib/dal/session";
import { homePath, jobsPath } from "@/lib/routes";

// The target of Post a Job in the public header, so that no page of the public area carries the address of an
// organisation. An employer goes to the new-vacancy page of the first organisation in which they may publish (an owner
// or an admin that is not suspended), or to their dashboard while there is none; anyone else goes to their own area, and
// a visitor to log in and back here.
export default async function PostJobPage({ params }: PageProps<"/[lang]/post-job">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind !== "company") redirect(homePath(lang, user.accountKind));
  const organizations = await getMyOrganizations(user.id);
  const publisher = publishingOrganization(organizations);
  redirect(publisher ? `${jobsPath(lang, publisher.slug)}/new` : homePath(lang, "company"));
}
