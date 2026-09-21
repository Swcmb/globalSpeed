import { gvar } from "@/globalVar"
import { between } from "@/utils/helper"
import { SubscribeView } from "@/utils/state"
import { aggressiveRateLocker, BPlayerAdapter } from "./utils/aggressiveRateLock"
import { IS_DOUYIN, IS_VKBROTHER } from "./utils/isWebsite"

export class SpeedSync {
	intervalId: number
	latest: { freePitch: boolean; speed: number }
	holdToSpeed: number
	holdToSpeedForKeyboard: number
	speedClient?: SubscribeView
	pointerDownAt: number
	keyDownAt: number
	constructor() {
		window.addEventListener("pointerdown", this.handlePointerDown, { capture: true, passive: true })
		window.addEventListener("pointerup", this.handlePointerUp, { capture: true, passive: true })
		window.addEventListener("pointercancel", this.handlePointerCancel, { capture: true, passive: true })
		document.addEventListener("pointerleave", this.clearPointerDown, { capture: true, passive: true })
		window.addEventListener("keyup", this.handleKeyUp, { capture: true })

		// 初始化站点特定适配器
		if (IS_DOUYIN || IS_VKBROTHER) {
			if (IS_VKBROTHER) {
				BPlayerAdapter.init()
			}
		}
	}
	release = () => {
		clearInterval(this.intervalId)
		delete this.intervalId
		window.removeEventListener("pointerdown", this.handlePointerDown, true)
		window.removeEventListener("pointerup", this.handlePointerUp, true)
		window.removeEventListener("pointercancel", this.handlePointerCancel, true)
		document.removeEventListener("pointerleave", this.clearPointerDown, true)
		window.removeEventListener("keyup", this.handleKeyUp, true)

		// 清理站点特定适配器
		aggressiveRateLocker.stop()
		if (IS_VKBROTHER) {
			BPlayerAdapter.release()
		}
	}
	update = () => {
		if (this.latest) {
			this.intervalId = this.intervalId ?? setInterval(this.realize, 1000)
			gvar.os.mediaTower.forceSpeedCallbacks.add(this.realize)
			this.realize()

			// 启动站点特定主动锁定
			if (IS_DOUYIN || IS_VKBROTHER) {
				const speed = this.latest.speed
				if (this.holdToSpeed && this.pointerDownActive()) {
					aggressiveRateLocker.start(speed * this.holdToSpeed)
				} else if (this.holdToSpeedForKeyboard && this.keyDownActive()) {
					aggressiveRateLocker.start(speed * this.holdToSpeedForKeyboard)
				} else {
					aggressiveRateLocker.start(speed)
				}

				// 更新 BPlayer 适配器的速度
				if (IS_VKBROTHER) {
					BPlayerAdapter.updateSpeed(this.latest.speed)
				}
			}
		} else {
			this.intervalId = (clearInterval(this.intervalId), null)
			aggressiveRateLocker.stop()
		}
	}
	handlePointerDown = (e: PointerEvent) => {
		if (this.holdToSpeed && isLeftPointerOrMiddleMouse(e) && !this.keyDownActive()) {
			// If directly on video.
			if ((e.target as HTMLVideoElement)?.tagName === "VIDEO") {
				this.setPointerDownToNow()
				return
			}

			// If over a video.
			if (checkIfPointerOverVideo(document, e)) {
				this.setPointerDownToNow()
				return
			}

			// More thoroughly check if over a video.
			const shadowRoots = new Set(
				[...gvar.os.mediaTower.media].filter((v) => !v.paused && v.tagName === "VIDEO" && v.gsShadowRoot).map((v) => v.gsShadowRoot),
			)
			if (shadowRoots.size && [...shadowRoots].some((root) => checkIfPointerOverVideo(root, e))) {
				this.setPointerDownToNow()
			}
		}
	}
	setPointerDownToNow = () => {
		this.pointerDownAt = Date.now()
		setTimeout(this.realize, 620)
	}
	handlePointerUp = (e: PointerEvent) => {
		if (isLeftPointerOrMiddleMouse(e)) this.clearPointerDown()
	}
	handlePointerCancel = () => {
		this.clearPointerDown()
	}
	clearPointerDown = (e?: PointerEvent) => {
		if ((!e || e.relatedTarget === null) && this.pointerDownAt) {
			delete this.pointerDownAt
			this.realize()
		}
	}
	pointerDownActive = () => {
		return this.pointerDownAt && between(600, 30_000, Date.now() - this.pointerDownAt)
	}
	keyDownActive = () => {
		return this.keyDownAt && between(0, 30_000, Date.now() - this.keyDownAt)
	}
	processTemporarySpeed = (factor: number) => {
		if (factor) {
			this.holdToSpeedForKeyboard = factor
			this.keyDownAt = Date.now()
		} else {
			delete this.keyDownAt
		}
		this.realize()
	}
	handleKeyUp = () => {
		delete this.keyDownAt
	}
	previousUrl: string
	realize = () => {
		if (this.latest) {
			let speed = this.latest.speed
			if (this.holdToSpeed && this.pointerDownActive()) {
				speed *= this.holdToSpeed
			} else if (this.holdToSpeedForKeyboard && this.keyDownActive()) {
				speed *= this.holdToSpeedForKeyboard
			}

			gvar.os.mediaTower.applySpeedToAll(speed, this.latest.freePitch)
		}

		// Unrelated to speed: Update all other frames if top frame's URL changes.
		if (gvar.isTopFrame && this.previousUrl !== location.href) {
			this.previousUrl = location.href
			chrome.runtime.sendMessage({ type: "REQUEST_NOTIFY_TOP_FRAME_URL_CHANGE", value: this.previousUrl } as Messages)
		}
	}
}

const PROHIBITED_TYPES = new Set(["INPUT", "BUTTON", "TEXTAREA"])
const PROHIBITED_ROLES = new Set(["slider", "button", "togglebutton", "menuitem", "tab"])
function checkIfPointerOverVideo(doc: DocumentOrShadowRoot, e: PointerEvent) {
	const elems = doc.elementsFromPoint(e.clientX, e.clientY)
	return (
		elems.some((elem) => elem.tagName === "VIDEO") &&
		elems.every((elem) => !PROHIBITED_TYPES.has(elem.tagName) && !PROHIBITED_ROLES.has(elem.role) && !(elem as HTMLElement).draggable)
	)
}

function isLeftPointerOrMiddleMouse(e: PointerEvent) {
	if (e.button === 0) return true
	if (e.button === 1 && e.pointerType === "mouse") return true
}
