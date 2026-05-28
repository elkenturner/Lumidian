import { redirect } from 'next/navigation';

export default function AgencyHomeRedirect() {
  redirect('/agency/clients');
}
