export const getSchedulingExampleScript = (scriptType: 'DELAYED' | 'RECURRING') => {
  const delayedExample = `// Example: Send 24 hours before appointment
const appointmentTime = parseDate(event.appointmentDateTime);
const scheduledTime = subtractHours(appointmentTime, 24);
toTimestamp(scheduledTime);`;

  const recurringExample = `// Example: Send every 6 hours, 3 times starting 1 hour from now
const firstTime = addHours(now(), 1);
({
  firstOccurrence: toTimestamp(firstTime),
  intervalMs: 6 * 60 * 60 * 1000,
  maxOccurrences: 3
});`;

  return scriptType === 'DELAYED' ? delayedExample : recurringExample;
};
