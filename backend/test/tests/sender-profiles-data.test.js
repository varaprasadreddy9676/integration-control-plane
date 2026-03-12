'use strict';

const mockCollection = {
  createIndexes: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
  deleteOne: jest.fn(),
};

const mockDb = {
  collection: jest.fn(() => mockCollection),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  toObjectId: jest.fn((value) => `oid:${value}`),
}));

const senderProfiles = require('../../src/data/sender-profiles');

describe('sender-profiles data layer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.collection.mockReturnValue(mockCollection);
    mockCollection.createIndexes.mockResolvedValue(undefined);
    mockCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollection.findOne.mockResolvedValue(null);
    mockCollection.insertOne.mockResolvedValue({ insertedId: 'sender-1' });
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    mockCollection.updateMany.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });
  });

  it('creates a unique partial default index per org', async () => {
    await senderProfiles.ensureIndexes();

    expect(mockCollection.createIndexes).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'org_single_default_unique_idx',
          unique: true,
          partialFilterExpression: { isDefault: true },
        }),
      ])
    );
  });

  it('rejects inactive default sender profiles', () => {
    expect(() =>
      senderProfiles.validateSenderProfileInput({
        key: 'purchase',
        fromEmail: 'purchase@unityhospital.in',
        provider: 'SMTP',
        providerConfig: {
          host: 'smtp.bzsecure.in',
          port: 587,
          username: 'purchase@unityhospital.in',
          password: 'secret',
        },
        isDefault: true,
        isActive: false,
      })
    ).toThrow('Default sender profile must be active');
  });

  it('rejects creating the first sender profile as inactive', async () => {
    await expect(
      senderProfiles.createSenderProfile(784, {
        key: 'purchase',
        fromEmail: 'purchase@unityhospital.in',
        provider: 'SMTP',
        providerConfig: {
          host: 'smtp.bzsecure.in',
          port: 587,
          username: 'purchase@unityhospital.in',
          password: 'secret',
        },
        isActive: false,
      })
    ).rejects.toThrow('The first sender profile for an org must be active and default');
  });

  it('rejects deleting the only active default sender profile', async () => {
    mockCollection.findOne
      .mockResolvedValueOnce({
        _id: 'existing-id',
        orgId: 784,
        key: 'purchase',
        isDefault: true,
        isActive: true,
      })
      .mockResolvedValueOnce(null);

    await expect(senderProfiles.deleteSenderProfile(784, 'existing-id')).rejects.toThrow(
      'Cannot delete the only active default sender profile'
    );
  });
});
