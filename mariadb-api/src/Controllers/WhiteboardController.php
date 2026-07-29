<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Realtime\Broadcaster;
use Enkl\Api\Services\WhiteboardService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Ported from Controllers/WhiteboardController.cs (php-api's own port is the direct template).
 * Org-wide collaborative whiteboard — RequireAuthMiddleware only (no ProjectMember/OrgAdmin), since
 * any org user can start or join a session, mirroring ChatController's own org-wide shape. */
final class WhiteboardController extends BaseController
{
    private function service(): WhiteboardService
    {
        return new WhiteboardService(Database::connection());
    }

    public function create(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $result = $this->service()->createSession($this->callerOrgId($request), $this->callerUserId($request), $body['title'] ?? null);
        return $this->json($response, $result);
    }

    public function join(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $result = $this->service()->joinSession($this->callerOrgId($request), $this->callerUserId($request), (string) ($body['joinCode'] ?? ''));
        if ($result === null) {
            return $this->notFound($response);
        }

        $this->broadcastParticipant($request, $result['state']['id'], $result['participantUserIds'], 'joined');
        return $this->json($response, $result['state']);
    }

    public function getState(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->getState($this->callerOrgId($request), $this->callerUserId($request), $args['id']);
        return $result === null ? $this->notFound($response) : $this->json($response, $result);
    }

    public function addElement(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $result = $this->service()->addElement(
            $this->callerOrgId($request), $this->callerUserId($request), $args['id'],
            (string) ($body['elementType'] ?? ''), (string) ($body['elementJson'] ?? '')
        );
        if ($result === null) {
            return $this->notFound($response);
        }

        $this->broadcastElement($request, $args['id'], $result['element'], $result['participantUserIds'], 'added');
        return $this->json($response, $result['element']);
    }

    public function removeElement(Request $request, Response $response, array $args): Response
    {
        $otherParticipantUserIds = $this->service()->removeElement(
            $this->callerOrgId($request), $this->callerUserId($request), $args['id'], $args['elementId']
        );
        if ($otherParticipantUserIds === null) {
            return $this->notFound($response);
        }

        $removedElement = ['id' => $args['elementId'], 'elementType' => '', 'elementJson' => '', 'createdByUserId' => $this->callerUserId($request), 'createdAt' => gmdate('Y-m-d\TH:i:s\Z')];
        $this->broadcastElement($request, $args['id'], $removedElement, $otherParticipantUserIds, 'removed');
        return $this->noContent($response);
    }

    // Best-effort — a notification failure must never fail the mutation itself, same convention as
    // ChatController's own broadcast helper.
    private function broadcastElement(Request $request, string $sessionId, array $element, array $otherParticipantUserIds, string $changeType): void
    {
        try {
            $clientSessionId = $request->getHeaderLine('X-Client-Session-Id') ?: null;
            (new Broadcaster(Database::connection()))->broadcastWhiteboardElement($otherParticipantUserIds, $sessionId, $element, $changeType, $clientSessionId);
        } catch (\Throwable) {
            // best-effort, see comment above
        }
    }

    public function leave(Request $request, Response $response, array $args): Response
    {
        $remaining = $this->service()->leaveSession($this->callerOrgId($request), $this->callerUserId($request), $args['id']);
        if ($remaining === null) {
            return $this->notFound($response);
        }

        $this->broadcastParticipant($request, $args['id'], $remaining, 'left');
        return $this->noContent($response);
    }

    public function save(Request $request, Response $response, array $args): Response
    {
        $ok = $this->service()->saveSession($this->callerOrgId($request), $this->callerUserId($request), $args['id']);
        return $ok ? $this->noContent($response) : $this->notFound($response);
    }

    public function close(Request $request, Response $response, array $args): Response
    {
        $participantUserIds = $this->service()->closeSession($this->callerOrgId($request), $this->callerUserId($request), $args['id']);
        if ($participantUserIds === null) {
            return $this->notFound($response);
        }

        try {
            (new Broadcaster(Database::connection()))->broadcastWhiteboardSessionClosed($participantUserIds, $args['id']);
        } catch (\Throwable) {
            // best-effort, same convention as ChatController's own broadcast helpers
        }
        return $this->noContent($response);
    }

    // Best-effort — a notification failure must never fail the mutation itself, same convention as
    // ChatController's own broadcast helper.
    private function broadcastParticipant(Request $request, string $sessionId, array $otherParticipantUserIds, string $changeType): void
    {
        try {
            $clientSessionId = $request->getHeaderLine('X-Client-Session-Id') ?: null;
            (new Broadcaster(Database::connection()))->broadcastWhiteboardParticipant(
                $otherParticipantUserIds, $sessionId, $this->callerUserId($request), $this->callerDisplayName($request) ?? 'Someone', $changeType, $clientSessionId
            );
        } catch (\Throwable) {
            // best-effort, see comment above
        }
    }
}
