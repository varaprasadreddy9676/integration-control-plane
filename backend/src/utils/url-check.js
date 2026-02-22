const net = require('net');
const { URL } = require('url');

const privateBlocks = [
  { cidr: '10.0.0.0/8' },
  { cidr: '172.16.0.0/12' },
  { cidr: '192.168.0.0/16' },
  { cidr: '127.0.0.0/8' },
  { cidr: '0.0.0.0/8' },
  { cidr: '169.254.0.0/16' },
  { cidr: '::1/128' },
  { cidr: 'fc00::/7' },
  { cidr: 'fe80::/10' },
];

function ipToBuffer(ip) {
  return net.isIP(ip) === 4
    ? Buffer.from(ip.split('.').map((part) => parseInt(part, 10)))
    : Buffer.from(
        ip
          .split(':')
          .filter(Boolean)
          .map((h) => parseInt(h, 16))
          .flatMap((num) => [(num >> 8) & 0xff, num & 0xff])
      );
}

function cidrToBuffer(cidr) {
  const [address, prefixLength] = cidr.split('/');
  return { buffer: ipToBuffer(address), prefixLength: parseInt(prefixLength, 10) };
}

function isInRange(ip, cidr) {
  const ipBuf = ipToBuffer(ip);
  const { buffer: rangeBuf, prefixLength } = cidrToBuffer(cidr);
  const byteLength = Math.ceil(prefixLength / 8);
  for (let i = 0; i < byteLength; i += 1) {
    const mask = i === byteLength - 1 ? 0xff << (8 - (prefixLength % 8 || 8)) : 0xff;
    if ((ipBuf[i] & mask) !== (rangeBuf[i] & mask)) return false;
  }
  return true;
}

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return false;
  return privateBlocks.some((block) => isInRange(ip, block.cidr));
}

function validateTargetUrl(targetUrl, { enforceHttps = true, blockPrivateNetworks = true } = {}) {
  if (!targetUrl) {
    return { valid: false, reason: 'URL required' };
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (_err) {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (enforceHttps && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'HTTPS required' };
  }

  if (blockPrivateNetworks) {
    const host = parsed.hostname;
    if (host === 'localhost') {
      return { valid: false, reason: 'Localhost is not allowed' };
    }
    if (net.isIP(host) && isPrivateIp(host)) {
      return { valid: false, reason: 'Private IP not allowed' };
    }
  }

  return { valid: true };
}

module.exports = { validateTargetUrl };
