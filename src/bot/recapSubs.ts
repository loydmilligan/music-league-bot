export type RecapSub = { subscribed: boolean; time?: string } | undefined;

/** Stub until sprint 3: undefined = no recap line. Never throws. */
export function recapSubscription(_dmTarget: string): RecapSub {
  return undefined;
}
