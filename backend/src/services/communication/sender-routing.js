const { ValidationError } = require('../../utils/errors');
const senderProfiles = require('../../data/sender-profiles');

const normalizeEmail = senderProfiles.normalizeEmail;

const ensureObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

function isSenderRoutingEnabled(communicationConfig) {
  return communicationConfig?.channel === 'EMAIL' && communicationConfig?.senderRouting?.enabled === true;
}

async function resolveSenderRoute({ orgId, communicationConfig, payload }) {
  if (!isSenderRoutingEnabled(communicationConfig)) {
    return null;
  }

  const senderRouting = ensureObject(communicationConfig.senderRouting);
  const profiles = await senderProfiles.getActiveSenderProfiles(orgId);
  if (!profiles.length) {
    throw new ValidationError('No active sender profiles are configured for this org');
  }

  const fromField = senderRouting.sourceField || 'from';
  const requestedFrom = normalizeEmail(payload?.[fromField]);

  const defaultProfile = profiles.find((profile) => profile.isDefault)
    || profiles.find((profile) => profile._id?.toString() === String(senderRouting.defaultProfileId || ''))
    || profiles.find((profile) => profile.key === senderRouting.defaultProfileKey)
    || profiles[0];

  const matchedProfile = requestedFrom
    ? profiles.find((profile) =>
        profile.normalizedFromEmail === requestedFrom
        || (Array.isArray(profile.normalizedAliases) && profile.normalizedAliases.includes(requestedFrom))
      )
    : null;

  let resolvedProfile = matchedProfile;
  let routingDecision = 'matched';

  if (!resolvedProfile && !requestedFrom) {
    if (senderRouting.fallbackToDefaultOnMissingFrom === false) {
      throw new ValidationError(`Missing required sender field '${fromField}'`);
    }
    resolvedProfile = defaultProfile;
    routingDecision = 'default_missing_from';
  }

  if (!resolvedProfile && requestedFrom) {
    if (senderRouting.fallbackToDefaultOnUnknownFrom === true) {
      resolvedProfile = defaultProfile;
      routingDecision = 'default_unknown_from';
    } else {
      throw new ValidationError(`Unknown sender email: ${requestedFrom}`);
    }
  }

  if (!resolvedProfile) {
    throw new ValidationError('Unable to resolve sender profile');
  }

  const provider = resolvedProfile.provider;
  const adapterConfig = {
    ...ensureObject(resolvedProfile.providerConfig),
    fromEmail: resolvedProfile.fromEmail,
  };

  const resolvedPayload = {
    ...payload,
    from: resolvedProfile.fromEmail,
  };

  return {
    provider,
    adapterConfig,
    payload: resolvedPayload,
    senderProfile: senderProfiles.mapSenderProfile(resolvedProfile),
    routingDecision,
    requestedFrom: requestedFrom || null,
  };
}

module.exports = {
  isSenderRoutingEnabled,
  resolveSenderRoute,
};
