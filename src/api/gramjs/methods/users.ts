import BigInt from 'big-integer';
import { Api as GramJs } from '../../../lib/gramjs';
import type {
  OnApiUpdate, ApiUser, ApiChat, ApiSticker,
} from '../../types';

import { COMMON_CHATS_LIMIT, PROFILE_PHOTOS_LIMIT } from '../../../config';
import { invokeRequest } from './client';
import { searchMessagesLocal } from './messages';
import {
  buildInputEntity,
  buildInputPeer,
  buildInputUser,
  buildInputContact,
  buildMtpPeerId,
  getEntityTypeById,
  buildInputEmojiStatus,
} from '../gramjsBuilders';
import { buildApiUser, buildApiUserFromFull, buildApiUsersAndStatuses } from '../apiBuilders/users';
import { buildApiChatFromPreview } from '../apiBuilders/chats';
import { buildApiPhoto } from '../apiBuilders/common';
import { addEntitiesWithPhotosToLocalDb, addPhotoToLocalDb, addUserToLocalDb } from '../helpers';
import { buildApiPeerId } from '../apiBuilders/peers';
import localDb from '../localDb';

let onUpdate: OnApiUpdate;

export function init(_onUpdate: OnApiUpdate) {
  onUpdate = _onUpdate;
}

export async function fetchFullUser({
  id,
  accessHash,
}: {
  id: string;
  accessHash?: string;
}) {
  const input = buildInputEntity(id, accessHash);
  if (!(input instanceof GramJs.InputUser)) {
    return undefined;
  }

  const fullInfo = await invokeRequest(new GramJs.users.GetFullUser({ id: input }));

  if (!fullInfo) {
    return undefined;
  }

  updateLocalDb(fullInfo);
  addUserToLocalDb(fullInfo.users[0], true);

  if (fullInfo.fullUser.profilePhoto instanceof GramJs.Photo) {
    localDb.photos[fullInfo.fullUser.profilePhoto.id.toString()] = fullInfo.fullUser.profilePhoto;
  }

  if (fullInfo.fullUser.personalPhoto instanceof GramJs.Photo) {
    localDb.photos[fullInfo.fullUser.personalPhoto.id.toString()] = fullInfo.fullUser.personalPhoto;
  }

  if (fullInfo.fullUser.fallbackPhoto instanceof GramJs.Photo) {
    localDb.photos[fullInfo.fullUser.fallbackPhoto.id.toString()] = fullInfo.fullUser.fallbackPhoto;
  }

  const botInfo = fullInfo.fullUser.botInfo;
  if (botInfo?.descriptionPhoto instanceof GramJs.Photo) {
    localDb.photos[botInfo.descriptionPhoto.id.toString()] = botInfo.descriptionPhoto;
  }
  if (botInfo?.descriptionDocument instanceof GramJs.Document) {
    localDb.documents[botInfo.descriptionDocument.id.toString()] = botInfo.descriptionDocument;
  }

  const userWithFullInfo = buildApiUserFromFull(fullInfo);
  const user = buildApiUser(fullInfo.users[0]);

  onUpdate({
    '@type': 'updateUser',
    id,
    user: {
      ...user,
      avatarHash: user?.avatarHash || undefined,
      fullInfo: userWithFullInfo.fullInfo,
    },
  });

  return userWithFullInfo;
}

export async function fetchCommonChats(id: string, accessHash?: string, maxId?: string) {
  const commonChats = await invokeRequest(new GramJs.messages.GetCommonChats({
    userId: buildInputEntity(id, accessHash) as GramJs.InputUser,
    maxId: maxId ? buildMtpPeerId(maxId, getEntityTypeById(maxId)) : undefined,
    limit: COMMON_CHATS_LIMIT,
  }));

  if (!commonChats) {
    return undefined;
  }

  updateLocalDb(commonChats);

  const chatIds: string[] = [];
  const chats: ApiChat[] = [];

  commonChats.chats.forEach((mtpChat) => {
    const chat = buildApiChatFromPreview(mtpChat);

    if (chat) {
      chats.push(chat);
      chatIds.push(chat.id);
    }
  });

  return { chats, chatIds, isFullyLoaded: chatIds.length < COMMON_CHATS_LIMIT };
}

export async function fetchNearestCountry() {
  const dcInfo = await invokeRequest(new GramJs.help.GetNearestDc());

  return dcInfo?.country;
}

export async function fetchTopUsers() {
  const topPeers = await invokeRequest(new GramJs.contacts.GetTopPeers({
    correspondents: true,
  }));
  if (!(topPeers instanceof GramJs.contacts.TopPeers)) {
    return undefined;
  }

  const users = topPeers.users.map(buildApiUser).filter((user) => Boolean(user) && !user.isSelf) as ApiUser[];
  const ids = users.map(({ id }) => id);

  return {
    ids,
    users,
  };
}

export async function fetchContactList() {
  const result = await invokeRequest(new GramJs.contacts.GetContacts({ hash: BigInt('0') }));
  if (!result || result instanceof GramJs.contacts.ContactsNotModified) {
    return undefined;
  }

  result.users.forEach((user) => {
    if (user instanceof GramJs.User) {
      addUserToLocalDb(user, true);
    }
  });

  const { users, userStatusesById } = buildApiUsersAndStatuses(result.users);

  return {
    users,
    userStatusesById,
    chats: result.users.map((user) => buildApiChatFromPreview(user)).filter(Boolean),
  };
}

export async function fetchUsers({ users }: { users: ApiUser[] }) {
  const result = await invokeRequest(new GramJs.users.GetUsers({
    // id: users.map(({ id, accessHash }) => buildInputPeer(id, accessHash)),
    id: users.map(({ id, accessHash }) => buildInputUser(id, accessHash)),
  }));
  if (!result || !result.length) {
    return undefined;
  }

  result.forEach((user) => {
    if (user instanceof GramJs.User) {
      addUserToLocalDb(user, true);
    }
  });

  return buildApiUsersAndStatuses(result);
}

export async function importContact({
  phone,
  firstName,
  lastName,
}: {
  phone?: string;
  firstName?: string;
  lastName?: string;
}) {
  const result = await invokeRequest(new GramJs.contacts.ImportContacts({
    contacts: [buildInputContact({
      phone: phone || '',
      firstName: firstName || '',
      lastName: lastName || '',
    })],
  }));

  if (result instanceof GramJs.contacts.ImportedContacts && result.users.length) {
    addUserToLocalDb(result.users[0]);
  }

  return result?.imported.length ? buildApiPeerId(result.imported[0].userId, 'user') : undefined;
}

export function updateContact({
  id,
  accessHash,
  phoneNumber = '',
  firstName = '',
  lastName = '',
  shouldSharePhoneNumber = false,
}: {
  id: string;
  accessHash?: string;
  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  shouldSharePhoneNumber?: boolean;
}) {
  return invokeRequest(new GramJs.contacts.AddContact({
    id: buildInputEntity(id, accessHash) as GramJs.InputUser,
    firstName,
    lastName,
    phone: phoneNumber,
    ...(shouldSharePhoneNumber && { addPhonePrivacyException: shouldSharePhoneNumber }),
  }), true);
}

export async function deleteContact({
  id,
  accessHash,
}: {
  id: string;
  accessHash?: string;
}) {
  const input = buildInputEntity(id, accessHash);
  if (!(input instanceof GramJs.InputUser)) {
    return;
  }

  const result = await invokeRequest(new GramJs.contacts.DeleteContacts({ id: [input] }));

  if (!result) {
    return;
  }

  onUpdate({
    '@type': 'deleteContact',
    id,
  });
}

export async function fetchProfilePhotos(user?: ApiUser, chat?: ApiChat) {
  if (user) {
    const { id, accessHash } = user;

    const result = await invokeRequest(new GramJs.photos.GetUserPhotos({
      userId: buildInputEntity(id, accessHash) as GramJs.InputUser,
      limit: PROFILE_PHOTOS_LIMIT,
      offset: 0,
      maxId: BigInt('0'),
    }));

    if (!result) {
      return undefined;
    }

    updateLocalDb(result);

    return {
      photos: result.photos
        .filter((photo): photo is GramJs.Photo => photo instanceof GramJs.Photo)
        .map((photo) => buildApiPhoto(photo)),
      users: result.users.map(buildApiUser).filter(Boolean),
    };
  }

  const result = await searchMessagesLocal({
    chat: chat!,
    type: 'profilePhoto',
    limit: PROFILE_PHOTOS_LIMIT,
  });

  if (!result) {
    return undefined;
  }

  const { messages, users } = result;

  return {
    photos: messages.map((message) => message.content.action!.photo).filter(Boolean),
    users,
  };
}

export function reportSpam(userOrChat: ApiUser | ApiChat) {
  const { id, accessHash } = userOrChat;

  return invokeRequest(new GramJs.messages.ReportSpam({
    peer: buildInputPeer(id, accessHash),
  }), true);
}

export function updateEmojiStatus(emojiStatus: ApiSticker, expires?: number) {
  return invokeRequest(new GramJs.account.UpdateEmojiStatus({
    emojiStatus: buildInputEmojiStatus(emojiStatus, expires),
  }), true);
}

function updateLocalDb(result: (GramJs.photos.Photos | GramJs.photos.PhotosSlice | GramJs.messages.Chats)) {
  if ('chats' in result) {
    addEntitiesWithPhotosToLocalDb(result.chats);
  }

  if ('photos' in result) {
    result.photos.forEach(addPhotoToLocalDb);
  }

  if ('users' in result) {
    addEntitiesWithPhotosToLocalDb(result.users);
  }
}
