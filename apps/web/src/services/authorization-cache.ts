import type { QueryClient } from '@tanstack/react-query';
import { onAuthorizationFailure } from './authorization';
export function bindAuthorizationCache(client:QueryClient) {
 return onAuthorizationFailure(event=>{
  const predicate=(query:{queryKey:readonly unknown[]})=>event.kind==='company'
   ?query.queryKey[0]===event.companyId
   :query.queryKey[0]==='identity' || (typeof query.queryKey[0]==='string' && /^[a-f0-9-]{36}$/i.test(query.queryKey[0]));
  // Cancellation is initiated synchronously; don't restore cached sensitive data.
  void client.cancelQueries({predicate},{revert:false});
  client.removeQueries({predicate});
 });
}
