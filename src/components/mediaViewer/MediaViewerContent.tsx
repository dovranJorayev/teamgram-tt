import type { FC } from '../../lib/teact/teact';
import React, { memo, useCallback } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type {
  ApiChat, ApiDimensions, ApiMessage, ApiUser,
} from '../../api/types';
import type { AnimationLevel } from '../../types';
import { MediaViewerOrigin } from '../../types';

import { IS_TOUCH_ENV } from '../../util/windowEnvironment';
import {
  selectChat, selectChatMessage, selectTabState, selectIsMessageProtected, selectScheduledMessage, selectUser,
} from '../../global/selectors';
import { calculateMediaViewerDimensions } from '../common/helpers/mediaDimensions';
import { renderMessageText } from '../common/helpers/renderMessageText';
import stopEvent from '../../util/stopEvent';
import buildClassName from '../../util/buildClassName';
import { useMediaProps } from './hooks/useMediaProps';
import useAppLayout from '../../hooks/useAppLayout';
import useLang from '../../hooks/useLang';

import Spinner from '../ui/Spinner';
import MediaViewerFooter from './MediaViewerFooter';
import VideoPlayer from './VideoPlayer';

import './MediaViewerContent.scss';

type OwnProps = {
  mediaId?: number;
  chatId?: string;
  threadId?: number;
  avatarOwnerId?: string;
  origin?: MediaViewerOrigin;
  isActive?: boolean;
  animationLevel: AnimationLevel;
  onClose: () => void;
  onFooterClick: () => void;
  setControlsVisible?: (isVisible: boolean) => void;
  areControlsVisible: boolean;
  isMoving?: boolean;
};

type StateProps = {
  chatId?: string;
  mediaId?: number;
  senderId?: string;
  threadId?: number;
  avatarOwner?: ApiChat | ApiUser;
  message?: ApiMessage;
  origin?: MediaViewerOrigin;
  isProtected?: boolean;
  volume: number;
  isMuted: boolean;
  isHidden?: boolean;
  playbackRate: number;
};

const ANIMATION_DURATION = 350;

const MediaViewerContent: FC<OwnProps & StateProps> = (props) => {
  const {
    mediaId,
    isActive,
    avatarOwner,
    chatId,
    message,
    origin,
    animationLevel,
    areControlsVisible,
    isProtected,
    volume,
    playbackRate,
    isMuted,
    isHidden,
    onClose,
    onFooterClick,
    setControlsVisible,
    isMoving,
  } = props;

  const lang = useLang();

  const isGhostAnimation = animationLevel === 2;

  const {
    isVideo,
    isPhoto,
    actionPhoto,
    bestImageData,
    bestData,
    dimensions,
    isGif,
    isVideoAvatar,
    videoSize,
    loadProgress,
  } = useMediaProps({
    message, avatarOwner, mediaId, origin, delay: isGhostAnimation && ANIMATION_DURATION,
  });

  const isOpen = Boolean(avatarOwner || mediaId);
  const { isMobile } = useAppLayout();

  const toggleControls = useCallback((isVisible) => {
    setControlsVisible?.(isVisible);
  }, [setControlsVisible]);

  if (avatarOwner || actionPhoto) {
    if (!isVideoAvatar) {
      return (
        <div key={chatId} className="MediaViewerContent">
          {renderPhoto(
            bestData,
            calculateMediaViewerDimensions(dimensions, false),
            !isMobile && !isProtected,
            isProtected,
          )}
        </div>
      );
    } else {
      return (
        <div key={chatId} className="MediaViewerContent">
          <VideoPlayer
            key={mediaId}
            url={bestData}
            isGif
            posterData={bestImageData}
            posterSize={calculateMediaViewerDimensions(dimensions!, false, true)}
            loadProgress={loadProgress}
            fileSize={videoSize!}
            isMediaViewerOpen={isOpen && isActive}
            areControlsVisible={areControlsVisible}
            toggleControls={toggleControls}
            isProtected={isProtected}
            noPlay={!isActive}
            onClose={onClose}
            isMuted
            shouldCloseOnClick
            volume={0}
            isClickDisabled={isMoving}
            playbackRate={1}
          />
        </div>
      );
    }
  }

  if (!message) return undefined;
  const textParts = message.content.action?.type === 'suggestProfilePhoto'
    ? lang('Conversation.SuggestedPhotoTitle')
    : renderMessageText(message);
  const hasFooter = Boolean(textParts);

  return (
    <div
      className={buildClassName('MediaViewerContent', hasFooter && 'has-footer')}
    >
      {isPhoto && renderPhoto(
        bestData,
        message && calculateMediaViewerDimensions(dimensions!, hasFooter),
        !isMobile && !isProtected,
        isProtected,
      )}
      {isVideo && (!isActive ? renderVideoPreview(
        bestImageData,
        message && calculateMediaViewerDimensions(dimensions!, hasFooter, true),
        !isMobile && !isProtected,
        isProtected,
      ) : (
        <VideoPlayer
          key={mediaId}
          url={bestData}
          isGif={isGif}
          posterData={bestImageData}
          posterSize={message && calculateMediaViewerDimensions(dimensions!, hasFooter, true)}
          loadProgress={loadProgress}
          fileSize={videoSize!}
          areControlsVisible={areControlsVisible}
          isMediaViewerOpen={isOpen && isActive}
          toggleControls={toggleControls}
          noPlay={!isActive}
          onClose={onClose}
          isMuted={isMuted}
          isHidden={isHidden}
          isProtected={isProtected}
          volume={volume}
          isClickDisabled={isMoving}
          playbackRate={playbackRate}
        />
      ))}
      {textParts && (
        <MediaViewerFooter
          text={textParts}
          onClick={onFooterClick}
          isProtected={isProtected}
          isHidden={IS_TOUCH_ENV ? !areControlsVisible : false}
          isForVideo={isVideo && !isGif}
        />
      )}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, ownProps): StateProps => {
    const {
      chatId,
      threadId,
      mediaId,
      avatarOwnerId,
      origin,
    } = ownProps;

    const {
      volume,
      isMuted,
      playbackRate,
      isHidden,
    } = selectTabState(global).mediaViewer;

    if (origin === MediaViewerOrigin.SearchResult) {
      if (!(chatId && mediaId)) {
        return { volume, isMuted, playbackRate };
      }

      const message = selectChatMessage(global, chatId, mediaId);
      if (!message) {
        return { volume, isMuted, playbackRate };
      }

      return {
        chatId,
        mediaId,
        senderId: message.senderId,
        origin,
        message,
        isProtected: selectIsMessageProtected(global, message),
        volume,
        isMuted,
        isHidden,
        playbackRate,
      };
    }

    if (avatarOwnerId) {
      const sender = selectUser(global, avatarOwnerId) || selectChat(global, avatarOwnerId);

      return {
        mediaId,
        senderId: avatarOwnerId,
        avatarOwner: sender,
        origin,
        volume,
        isMuted,
        isHidden,
        playbackRate,
      };
    }

    if (!(chatId && threadId && mediaId)) {
      return { volume, isMuted, playbackRate };
    }

    let message: ApiMessage | undefined;
    if (origin && [MediaViewerOrigin.ScheduledAlbum, MediaViewerOrigin.ScheduledInline].includes(origin)) {
      message = selectScheduledMessage(global, chatId, mediaId);
    } else {
      message = selectChatMessage(global, chatId, mediaId);
    }

    if (!message) {
      return { volume, isMuted, playbackRate };
    }

    return {
      chatId,
      threadId,
      mediaId,
      senderId: message.senderId,
      origin,
      message,
      isProtected: selectIsMessageProtected(global, message),
      volume,
      isMuted,
      isHidden,
      playbackRate,
    };
  },
)(MediaViewerContent));

function renderPhoto(blobUrl?: string, imageSize?: ApiDimensions, canDrag?: boolean, isProtected?: boolean) {
  return blobUrl
    ? (
      <div style="position: relative;">
        {isProtected && <div onContextMenu={stopEvent} className="protector" />}
        <img
          src={blobUrl}
          alt=""
          className={buildClassName(isProtected && 'is-protected')}
          style={imageSize ? `width: ${imageSize.width}px` : ''}
          draggable={Boolean(canDrag)}
        />
      </div>
    )
    : (
      <div
        className="spinner-wrapper"
        style={imageSize ? `width: ${imageSize.width}px` : ''}
      >
        <Spinner color="white" />
      </div>
    );
}

function renderVideoPreview(blobUrl?: string, imageSize?: ApiDimensions, canDrag?: boolean, isProtected?: boolean) {
  const wrapperStyle = imageSize && `width: ${imageSize.width}px; height: ${imageSize.height}px`;
  const videoStyle = `background-image: url(${blobUrl})`;
  return blobUrl
    ? (
      <div
        className="VideoPlayer"
      >
        {isProtected && <div onContextMenu={stopEvent} className="protector" />}
        <div
          style={wrapperStyle}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            style={videoStyle}
            className={buildClassName(isProtected && 'is-protected')}
            draggable={Boolean(canDrag)}
          />
        </div>
      </div>
    )
    : (
      <div
        className="spinner-wrapper"
        style={imageSize ? `width: ${imageSize.width}px` : ''}
      >
        <Spinner color="white" />
      </div>
    );
}
