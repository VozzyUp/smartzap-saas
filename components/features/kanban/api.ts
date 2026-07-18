import { api } from '@/lib/api'
import type { KanbanBoard, KanbanBoardData } from './types'

export async function listBoards(): Promise<KanbanBoard[]> {
  const data = await api.get<{ boards: KanbanBoard[] }>('/api/kanban/boards')
  return data.boards
}

export async function createBoard(name: string): Promise<KanbanBoard> {
  const data = await api.post<{ board: KanbanBoard }>('/api/kanban/boards', { name })
  return data.board
}

export async function renameBoard(boardId: string, name: string): Promise<void> {
  await api.patch(`/api/kanban/boards/${boardId}`, { name })
}

export async function deleteBoard(boardId: string): Promise<void> {
  await api.del(`/api/kanban/boards/${boardId}`)
}

export async function getBoardData(boardId: string): Promise<KanbanBoardData> {
  return api.get<KanbanBoardData>(`/api/kanban/boards/${boardId}/data`)
}

export async function createStage(
  boardId: string,
  params: { name: string; color: string }
): Promise<void> {
  await api.post(`/api/kanban/boards/${boardId}/stages`, params)
}

export async function updateStage(
  stageId: string,
  params: { name?: string; color?: string }
): Promise<void> {
  await api.patch(`/api/kanban/stages/${stageId}`, params)
}

export async function deleteStage(stageId: string): Promise<void> {
  await api.del(`/api/kanban/stages/${stageId}`)
}

export async function addCard(
  boardId: string,
  contactId: string,
  stageId?: string
): Promise<void> {
  await api.post(`/api/kanban/boards/${boardId}/cards`, { contactId, stageId })
}

export async function moveCard(
  cardId: string,
  params: { stageId: string; position: number }
): Promise<void> {
  await api.patch(`/api/kanban/cards/${cardId}`, params)
}

export async function removeCard(cardId: string): Promise<void> {
  await api.del(`/api/kanban/cards/${cardId}`)
}
