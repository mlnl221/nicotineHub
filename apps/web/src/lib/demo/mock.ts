"use client";

import type { BridgeInboundMessage, BridgeOutboundMessage } from "@/lib/protocol";
import { DEMO_ROOMS, mockBrowseFolders, mockProfile, mockRecommendations, mockSearchRows, mockSimilarUsers } from "./fixtures";

export type DemoListener = (msg: BridgeOutboundMessage) => void;

function emit(listeners: Set<DemoListener>, msg: BridgeOutboundMessage) {
  listeners.forEach((cb) => {
    try {
      cb(msg);
    } catch {}
  });
}

export function handleDemoSend(
  msg: BridgeInboundMessage,
  listeners: Set<DemoListener>,
  currentUser?: string,
): boolean {
  // Returns true if handled (demo), false if should fall through to real WS
  const anyMsg = msg as Record<string, unknown>;

  // Search handlers
  if (msg.type === "search" || msg.type === "search:user" || msg.type === "search:room" || msg.type === "search:wishlist") {
    const searchId = (msg as { searchId: string }).searchId;
    const query = (msg as { query?: string }).query || "";
    const token = Math.floor(Math.random() * 1e9);
    // send start
    setTimeout(() => emit(listeners, { type: "search:start", searchId, token }), 80);
    const rows = mockSearchRows(query, msg.type);
    // chunked results like real server
    const chunkSize = 10;
    let offset = 0;
    const sendChunk = () => {
      if (offset >= rows.length) {
        emit(listeners, { type: "search:end", searchId, reason: "max_results" });
        return;
      }
      const chunk = rows.slice(offset, offset + chunkSize);
      offset += chunkSize;
      emit(listeners, { type: "search:result", searchId, token, rows: chunk });
      if (offset < rows.length) setTimeout(sendChunk, 350);
      else setTimeout(() => emit(listeners, { type: "search:end", searchId, reason: "max_results" }), 400);
    };
    setTimeout(sendChunk, 250);
    return true;
  }
  if (msg.type === "search:stop") {
    // do nothing — search.tsx already marks ended
    return true;
  }

  if (msg.type === "browse") {
    const username = (msg as { username: string }).username;
    if (anyMsg.action === "shares") {
      setTimeout(() => {
        const folders = mockBrowseFolders(username);
        emit(listeners, { type: "browse:shares", username, folders });
      }, 400);
      return true;
    }
    if (anyMsg.action === "folder") {
      const folder = (msg as { folder: string }).folder;
      // For mock, just emit empty or folder files from seeded folder
      setTimeout(() => {
        const all = mockBrowseFolders(username);
        const match = all.find((f) => f.name === folder);
        emit(listeners, {
          type: "browse:folder",
          token: (msg as { token?: number }).token || 123,
          username,
          folder,
          files: match ? match.files : [],
        });
      }, 300);
      return true;
    }
  }

  if (msg.type === "chat:room") {
    const action = anyMsg.action as string;
    const room = anyMsg.room as string;
    if (action === "join") {
      setTimeout(() => {
        emit(listeners, {
          type: "room:event",
          event: { type: "join-room", room, data: { room, users: [{ username: currentUser || "demo" }, { username: "jazzcat" }, { username: "vinyl_hunter" }] } },
        });
        emit(listeners, {
          type: "room:event",
          event: { type: "room-members", room, data: ["demo", "jazzcat", "vinyl_hunter", "beat_miner"] },
        });
        // welcome message
        setTimeout(() => {
          emit(listeners, {
            type: "chat:event",
            event: { type: "say-chatroom", room, username: "jazzcat", message: `Welcome to ${room}! Demo mode — messages are simulated.` },
          });
        }, 600);
      }, 200);
      return true;
    }
    if (action === "leave") {
      return true;
    }
    if (action === "say") {
      const message = anyMsg.message as string;
      const user = currentUser || "demo";
      // echo back as if from server
      setTimeout(() => {
        emit(listeners, {
          type: "chat:event",
          event: { type: "say-chatroom", room, username: user, message },
        });
        // bot reply
        if (Math.random() > 0.3) {
          setTimeout(() => {
            const replies = [
              "Nice pick! 🎶",
              "I have that on vinyl!",
              "Check my shares, I might have more like that",
              "Demo mode — but great taste!",
            ];
            emit(listeners, {
              type: "chat:event",
              event: { type: "say-chatroom", room, username: "vinyl_hunter", message: replies[Math.floor(Math.random() * replies.length)] },
            });
          }, 900);
        }
      }, 150);
      return true;
    }
  }

  if (msg.type === "chat:private") {
    const username = (msg as { username: string }).username;
    const message = (msg as { message?: string }).message;
    if (anyMsg.action === "send" && message) {
      // already optimistic in privateChat.tsx; now simulate reply
      setTimeout(() => {
        emit(listeners, {
          type: "chat:event",
          event: { type: "private-message", username, message: `Demo auto-reply: Got your message "${message.slice(0, 40)}" — this is a mocked response.` , msgId: Date.now(), timestamp: Math.floor(Date.now()/1000) },
        });
      }, 1200);
      return true;
    }
  }
  if (msg.type === "chat:global") {
    return true;
  }

  if (msg.type === "userinfo") {
    const action = anyMsg.action as string;
    const username = anyMsg.username as string | undefined;
    const item = anyMsg.item as string | undefined;

    const sendProfileBundle = (uname: string) => {
      const bundle = mockProfile(uname);
      emit(listeners, { type: "userinfo:event", event: { type: "watch-user", username: uname, watchUser: bundle.watchUser } });
      emit(listeners, { type: "userinfo:event", event: { type: "user-status", username: uname, status: bundle.status } });
      emit(listeners, { type: "userinfo:event", event: { type: "user-stats", username: uname, stats: bundle.stats } });
      emit(listeners, { type: "userinfo:event", event: { type: "user-interests", username: uname, interests: bundle.interests } });
      // direct response (session.ts also listens to user-info-response)
      emit(listeners, { type: "user-info-response", username: uname, descr: bundle.info.descr, pic: bundle.info.pic, totalupl: bundle.info.totalupl, queuesize: bundle.info.queuesize, slotsavail: bundle.info.slotsavail, uploadallowed: bundle.info.uploadallowed });
      emit(listeners, { type: "userinfo:event", event: { type: "user-info-response", username: uname, info: bundle.info } });
      if (bundle.status.privileged) {
        emit(listeners, { type: "userinfo:event", event: { type: "privileged-users", privilegedUsers: [uname] } });
      }
    };

    if (action === "watch" || action === "get" || action === "interests") {
      if (username) setTimeout(() => sendProfileBundle(username), 250);
      return true;
    }
    if (action === "unwatch") return true;
    if (action === "peerAddress" && username) {
      setTimeout(() => {
        emit(listeners, { type: "userinfo:event", event: { type: "peer-address", username, peerAddress: { ip: "203.0.113.42", port: 2234 } } });
      }, 300);
      return true;
    }
    if (action === "recommendations" || action === "globalRecommendations") {
      setTimeout(() => {
        emit(listeners, { type: "userinfo:event", event: { type: "recommendations", recommendations: mockRecommendations() } });
        emit(listeners, { type: "userinfo:event", event: { type: "global-recommendations", recommendations: mockRecommendations() } });
        emit(listeners, { type: "userinfo:event", event: { type: "similar-users", similarUsers: mockSimilarUsers() } });
      }, 300);
      return true;
    }
    if (action === "similarUsers") {
      setTimeout(() => emit(listeners, { type: "userinfo:event", event: { type: "similar-users", similarUsers: mockSimilarUsers() } }), 250);
      return true;
    }
    if (action === "itemRecommendations" && item) {
      setTimeout(() => emit(listeners, { type: "userinfo:event", event: { type: "item-recommendations", recommendations: mockRecommendations().slice(0, 4) } }), 300);
      return true;
    }
    if (action === "itemSimilarUsers" && item) {
      setTimeout(() => emit(listeners, { type: "userinfo:event", event: { type: "item-similar-users", similarUsers: mockSimilarUsers().slice(0, 3) } }), 300);
      return true;
    }
    if (["addLike", "removeLike", "addHate", "removeHate"].includes(action)) {
      // locally handled in interests.tsx, just refresh
      setTimeout(() => emit(listeners, { type: "userinfo:event", event: { type: "recommendations", recommendations: mockRecommendations() } }), 200);
      return true;
    }
    if (action === "checkPrivileges") {
      setTimeout(() => emit(listeners, { type: "userinfo:event", event: { type: "check-privileges", checkPrivileges: 86400 * 30 } }), 200);
      return true;
    }
    if (action === "givePrivileges" || action === "setStatus" || action === "changePassword" || action === "reportShares" || action === "setProfile") {
      return true;
    }
  }

  if (msg.type === "download:request" || msg.type === "download:control" || msg.type === "upload:control") {
    // Disabled in demo — show error/quiet drop
    setTimeout(() => emit(listeners, { type: "error", error: "Demo — downloads/uploads are disabled on Vercel." }), 100);
    return true;
  }

  if (msg.type === "diagnostics:clear" || msg.type === "diagnostics:subscribe" || msg.type === "diagnostics:browser-log") {
    return true;
  }

  // Room list on connect: send initial list after short delay for rooms page
  // We use a side effect: when login succeeds, roomList will be requested implicitly? For now handle any unknown as noop.
  return false;
}

export function emitRoomList(listeners: Set<DemoListener>) {
  setTimeout(() => {
    emit(listeners, {
      type: "room:event",
      event: { type: "room-list", data: { rooms: DEMO_ROOMS } },
    });
  }, 400);
}
