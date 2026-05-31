import ctypes
import time
import random
import numpy as np
import logging

if not logging.getLogger().hasHandlers():
    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler()
        ]
    )

class Mouse_Action:
    # 保持所有方法为静态方法
    @staticmethod
    def key_press(key):
        """
        模拟按键按下并释放
        :param key: 字符串，如 'A', 'ENTER', 'SPACE' 等
        """
        vk_code = Mouse_Action._get_vk_code(key)
        if vk_code is None:
            logging.info(f"不支持的键: {key}")
            return
        
        # 由于是静态方法，需要创建临时实例来获取user32
        instance = Mouse_Action()
        instance.user32.keybd_event(vk_code, 0, 0, 0)
        time.sleep(0.05)  # 短暂按下
        instance.user32.keybd_event(vk_code, 0, instance.KEYEVENTF_KEYUP, 0)

    @staticmethod
    def key_down(key):
        """
        按下某个键（不释放）
        :param key: 键名
        """
        vk_code = Mouse_Action._get_vk_code(key)
        if vk_code is None:
            logging.info(f"不支持的键: {key}")
            return
        instance = Mouse_Action()
        instance.user32.keybd_event(vk_code, 0, 0, 0)

    @staticmethod
    def key_up(key):
        """
        释放某个键
        :param key: 键名
        """
        vk_code = Mouse_Action._get_vk_code(key)
        if vk_code is None:
            logging.info(f"不支持的键: {key}")
            return
        instance = Mouse_Action()
        instance.user32.keybd_event(vk_code, 0, instance.KEYEVENTF_KEYUP, 0)

    @staticmethod
    def mouse_move(x, y):
        """
        移动鼠标到指定屏幕坐标 (x, y)
        :param x: 屏幕x坐标
        :param y: 屏幕y坐标
        """
        instance = Mouse_Action()
        # 转换为绝对坐标（0~65535）
        abs_x = int(x * 65535 / instance.width)
        abs_y = int(y * 65535 / instance.height)
        instance.user32.mouse_event(instance.MOUSEEVENTF_ABSOLUTE | instance.MOUSEEVENTF_MOVE, abs_x, abs_y, 0, 0)

    @staticmethod
    def mouse_left_down():
        """按下鼠标左键"""
        instance = Mouse_Action()
        instance.user32.mouse_event(instance.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)

    @staticmethod
    def mouse_left_up():
        """释放鼠标左键"""
        instance = Mouse_Action()
        instance.user32.mouse_event(instance.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

    @staticmethod
    def mouse_left_click():
        """鼠标左键单击"""
        Mouse_Action.mouse_left_down()
        time.sleep(random.uniform(0.1, 0.15))  # 模拟人类按键时间
        Mouse_Action.mouse_left_up()

    @staticmethod
    def mouse_right_down():
        """按下鼠标右键"""
        instance = Mouse_Action()
        instance.user32.mouse_event(instance.MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)

    @staticmethod
    def mouse_right_up():
        """释放鼠标右键"""
        instance = Mouse_Action()
        instance.user32.mouse_event(instance.MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)

    @staticmethod
    def mouse_right_click():
        """鼠标右键单击"""
        Mouse_Action.mouse_right_down()
        time.sleep(random.uniform(0.1, 0.15))  # 模拟人类按键时间
        Mouse_Action.mouse_right_up()

    @staticmethod
    def mouse_middle_down():
        """按下鼠标中键"""
        instance = Mouse_Action()
        instance.user32.mouse_event(instance.MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0)

    @staticmethod
    def mouse_middle_up():
        """释放鼠标中键"""
        instance = Mouse_Action()
        instance.user32.mouse_event(instance.MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0)

    @staticmethod
    def _get_vk_code(key):
        """
        将键名转换为虚拟键码
        """
        key = key.upper()
        return Mouse_Action.VK.get(key)
    
    # 以下为静态方法需要的类属性
    VK = {
        # 通用按键
        'ESCAPE': 0x1B,          # ESC
        'ENTER': 0x0D,           # 回车
        'SPACE': 0x20,           # 空格
        'TAB': 0x09,             # Tab
        'BACK': 0x08,            # Backspace
        'CAPITAL': 0x14,         # Caps Lock
        'NUMLOCK': 0x90,         # Num Lock
        'SCROLL': 0x91,          # Scroll Lock
        'PRINTSCREEN': 0x2C,     # Print Screen
        'PAUSE': 0x13,           # Pause/Break
        'INSERT': 0x2D,          # Insert
        'DELETE': 0x2E,          # Delete
        'HELP': 0x2F,            # Help (辅助键)

        # 方向与导航键
        'UP': 0x26,              # 上箭头
        'DOWN': 0x28,            # 下箭头
        'LEFT': 0x25,            # 左箭头
        'RIGHT': 0x27,           # 右箭头
        'HOME': 0x24,            # Home
        'END': 0x23,             # End
        'PGUP': 0x21,            # Page Up
        'PGDN': 0x22,            # Page Down

        # 功能键
        'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73,
        'F5': 0x74, 'F6': 0x75, 'F7': 0x76, 'F8': 0x77,
        'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
        'F13': 0x7C, 'F14': 0x7D, 'F15': 0x7E, 'F16': 0x7F,
        'F17': 0x80, 'F18': 0x81, 'F19': 0x82, 'F20': 0x83,
        'F21': 0x84, 'F22': 0x85, 'F23': 0x86, 'F24': 0x87,

        # 控制与修改键
        'LCONTROL': 0xA2,        # 左 Ctrl
        'RCONTROL': 0xA3,        # 右 Ctrl
        'LSHIFT': 0xA0,          # 左 Shift
        'RSHIFT': 0xA1,          # 右 Shift
        'LALT': 0xA4,            # 左 Alt
        'RALT': 0xA5,            # 右 Alt
        'LWIN': 0x5B,            # 左 Windows 键
        'RWIN': 0x5C,            # 右 Windows 键
        'APP': 0x5D,             # 应用程序键 (右 Alt 旁)

        # 字母键 (A-Z)
        'A': 0x41, 'B': 0x42, 'C': 0x43, 'D': 0x44, 'E': 0x45, 'F': 0x46,
        'G': 0x47, 'H': 0x48, 'I': 0x49, 'J': 0x4A, 'K': 0x4B, 'L': 0x4C,
        'M': 0x4D, 'N': 0x4E, 'O': 0x4F, 'P': 0x50, 'Q': 0x51, 'R': 0x52,
        'S': 0x53, 'T': 0x54, 'U': 0x55, 'V': 0x56, 'W': 0x57, 'X': 0x58,
        'Y': 0x59, 'Z': 0x5A,

        # 数字键 (0-9)
        '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
        '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,

        # 小键盘键 (Numpad)
        'NUMPAD0': 0x60, 'NUMPAD1': 0x61, 'NUMPAD2': 0x62,
        'NUMPAD3': 0x63, 'NUMPAD4': 0x64, 'NUMPAD5': 0x65,
        'NUMPAD6': 0x66, 'NUMPAD7': 0x67, 'NUMPAD8': 0x68,
        'NUMPAD9': 0x69,
        'MULTIPLY': 0x6A,        # *
        'ADD': 0x6B,             # +
        'SEPARATOR': 0x6C,       # 小数点（日文键盘）
        'SUBTRACT': 0x6D,        # -
        'DECIMAL': 0x6E,         # .
        'DIVIDE': 0x6F,          # /

        # OEM 特殊字符键（与键盘布局相关）
        'OEM_1': 0xBA,           # ; 或 : （美式键盘）
        'OEM_PLUS': 0xBB,        # =
        'OEM_COMMA': 0xBC,       # ,
        'OEM_MINUS': 0xBD,       # -
        'OEM_PERIOD': 0xBE,      # .
        'OEM_2': 0xBF,           # / 或 ?
        'OEM_3': 0xC0,           # ` 或 ~
        'OEM_4': 0xDB,           # [ 或 {
        'OEM_5': 0xDC,           # \ 或 |
        'OEM_6': 0xDD,           # ] 或 }
        'OEM_7': 0xDE,           # ' 或 "
        'OEM_8': 0xDF,           # 语言相关符号

        # 多媒体与扩展功能键
        'VOLUME_MUTE': 0xAD,
        'VOLUME_DOWN': 0xAE,
        'VOLUME_UP': 0xAF,
        'MEDIA_NEXT_TRACK': 0xB0,
        'MEDIA_PREV_TRACK': 0xB1,
        'MEDIA_STOP': 0xB2,
        'MEDIA_PLAY_PAUSE': 0xB3,
        'LAUNCH_MAIL': 0xB4,     # 打开邮件
        'LAUNCH_MEDIA_SELECT': 0xB5,  # 打开媒体选择
        'LAUNCH_APP1': 0xB6,     # 启动应用程序1
        'LAUNCH_APP2': 0xB7,     # 启动应用程序2

        # 浏览器控制键
        'BROWSER_BACK': 0xA6,
        'BROWSER_FORWARD': 0xA7,
        'BROWSER_REFRESH': 0xA8,
        'BROWSER_STOP': 0xA9,
        'BROWSER_SEARCH': 0xAA,
        'BROWSER_FAVORITES': 0xAB,
        'BROWSER_HOME': 0xAC,

        # 其他特殊键
        'POWER': 0x5E,           # 电源键
        'SLEEP': 0x5F,           # 睡眠键
        'WAKE': 0x5F,            # 唤醒键（与 SLEEP 同值）
        'WEBAPP': 0x5F,          # 网络应用键（部分设备）

        # IME 输入法相关键
        'IME_JUNJA': 0x17,
        'IME_KANJI': 0x19,
        'IME_HANGUL': 0x19,
        'IME_HANJA': 0x19,
        'IME_HIRAGANA': 0x1A,
        'IME_KATAKANA': 0x1B,
        'IME_ROMAN': 0x1C,
        'IME_USE_DBCS': 0x1D,
        'IME_PROCESS': 0x1D,
        'IME_SELECT': 0x1E,
        'IME_AWAY': 0x1F,
        'IME_EISU': 0x1F,
        'IME_CONVERT': 0x1C,
        'IME_NONCONVERT': 0x1D,
        'IME_ACCEPT': 0x1C,
        'IME_MODECHANGE': 0x1F,

        # 游戏手柄/外设扩展键（部分系统支持）
        'XBUTTON_L': 0x5B,       # 左 X 按钮（非标准）
        'XBUTTON_R': 0x5C,       # 右 X 按钮（非标准）
    }

    # 类属性（在静态方法中使用）
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    KEYEVENTF_KEYUP = 0x0002
    MOUSEEVENTF_ABSOLUTE = 0x8000  # 使用绝对坐标
    MOUSEEVENTF_MOVE = 0x0001     # 移动
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010
    MOUSEEVENTF_MIDDLEDOWN = 0x0020
    MOUSEEVENTF_MIDDLEUP = 0x0040
    width = user32.GetSystemMetrics(0)  # SM_CXSCREEN
    height = user32.GetSystemMetrics(1) # SM_CYSCREEN
    move_speed = 100  # 每步移动的像素数（越大越快）
    scale = 0.4 #1k-0.4,2k-0.32

    ############################################## 拟人操作 #################################################
    @staticmethod
    def _humanize_offset(value, no_jitter_prob=0.93):
        """添加拟人化抖动"""
        jitter_prob = (1 - no_jitter_prob) / 2
        jitter = random.choices(
            population=[-1, 0, 1],
            weights=[jitter_prob, no_jitter_prob, jitter_prob]
        )[0]
        return value + jitter
    
    @staticmethod
    def generate_moves(dx, dy, steps=1):
        """生成平滑的鼠标移动步骤"""
        moves = []
        accumulated_dx = 0
        accumulated_dy = 0
        scaled_dx = dx * Mouse_Action.scale
        scaled_dy = dy * Mouse_Action.scale

        target_positions = []
        for step in range(steps):
            t = step / (steps - 1) if steps > 1 else 1.0
            speed_ratio = 1.0 - (1.0 - t) ** 2  # 先快后慢
            target_x = scaled_dx * speed_ratio
            target_y = scaled_dy * speed_ratio
            target_positions.append((target_x, target_y))

        for step in range(steps):
            tx, ty = target_positions[step]
            dx_step_float = tx - accumulated_dx
            dy_step_float = ty - accumulated_dy
            dx_step = int(round(dx_step_float))
            dy_step = int(round(dy_step_float))

            dx_step = Mouse_Action._humanize_offset(dx_step)
            dy_step = Mouse_Action._humanize_offset(dy_step)

            remaining_dx = scaled_dx - accumulated_dx
            remaining_dy = scaled_dy - accumulated_dy

            if abs(dx_step) > abs(remaining_dx):
                dx_step = int(remaining_dx) if remaining_dx >= 0 else int(-remaining_dx)
            if abs(dy_step) > abs(remaining_dy):
                dy_step = int(remaining_dy) if remaining_dy >= 0 else int(-remaining_dy)

            accumulated_dx += dx_step
            accumulated_dy += dy_step
            moves.append((dx_step, dy_step))

            if step == steps - 1:
                final_dx = int(round(scaled_dx - accumulated_dx))
                final_dy = int(round(scaled_dy - accumulated_dy))
                if final_dx != 0 or final_dy != 0:
                    last_dx, last_dy = moves[-1]
                    moves[-1] = (last_dx + final_dx, last_dy + final_dy)

        return moves
    
    @staticmethod
    def get_cursor_pos():
        """获取当前鼠标位置"""
        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
        point = POINT()
        Mouse_Action.user32.GetCursorPos(ctypes.byref(point))
        return point.x, point.y

    @staticmethod
    def move_mouse_rel_batch(moves, interval=0.01):
        """批量执行相对移动"""
        for dx, dy in moves:
            Mouse_Action.user32.mouse_event(Mouse_Action.MOUSEEVENTF_MOVE, dx, dy, 0, 0)
            time.sleep(interval)

    @staticmethod
    def smooth_mouse_move(target_x, target_y, interval=0.01):
        """拟人化平滑移动到目标位置"""
        current_x, current_y = Mouse_Action.get_cursor_pos()
        dx = target_x - current_x
        dy = target_y - current_y

        # 动态计算步数
        total_distance = abs(dx) + abs(dy)
        steps = max(30, int(total_distance / Mouse_Action.move_speed))  # 基于 move_speed 自动计算步数
        moves = Mouse_Action.generate_moves(dx, dy, steps=steps)
        Mouse_Action.move_mouse_rel_batch(moves, interval=interval)

    ############################################## 功能函数 #################################################
    # 计算点击坐标
    @staticmethod
    def photo_click_point(top, left, width, height):
        return int(left + width / 2), int(top + height / 2)

# ==================== 使用示例（静态方法调用） ====================
if __name__ == '__main__':
    # 直接通过类名调用，不需要创建实例
    print(f"当前屏幕尺寸: {Mouse_Action.width}x{Mouse_Action.height}")
    
    # 移动到屏幕中心
    center_x = Mouse_Action.width // 2
    center_y = Mouse_Action.height // 2
    print(f"将移动到屏幕中心: ({center_x}, {center_y})")
    
    Mouse_Action.smooth_mouse_move(center_x, center_y)
    time.sleep(1)
    
    # 鼠标左键单击
    Mouse_Action.mouse_left_click()
    time.sleep(1)
    
    # 按下A键
    Mouse_Action.key_press('A')