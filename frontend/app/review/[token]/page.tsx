import { redirect } from 'next/navigation';

export default async function ReviewRedirect({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/client/${token}`);
}
