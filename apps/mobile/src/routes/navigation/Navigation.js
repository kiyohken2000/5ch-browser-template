/**
 * ナビゲーション（§7）。
 *
 * ボイラープレートはログインの有無で分岐する作りだったが、**Ember に
 * アプリレベルのログインは無い。** 5ch の認証（Ronin / BE / どんぐり）は
 * 投稿のときだけ要るもので、読むだけなら不要なので M2 で投稿画面側に付ける。
 *
 *   BottomTabs
 *   ├─ ホーム    監視リスト
 *   ├─ 板        カテゴリツリー → スレ一覧
 *   ├─ 検索      スレ横断検索
 *   └─ 設定      表示設定 + NG 管理
 *   タブの最上位の 4 画面にヘッダーは置かない。どの画面かはタブバーで分かるので、
 *   その高さを中身に回す。戻る操作が要るスレ一覧とスレビューには残す。
 *   スレビューはタブの外のルートスタックに push する（§7）。**同時に開くスレは
 *   1 つだけ**で、タブバーは隠れて本文が広くなる。スレ間の移動はホームから
 *
 * `ember://` で外部からスレと板を開ける（§8-1）。URL は開く先の画面で
 * `parseBoardLocation` を通るので、対応ホスト以外は取得前に止まる。
 *   ember://thread?threadUrl=<スレ URL>
 *   ember://board?boardUrl=<板 URL>&boardName=<板名>
 *   ember://search / ember://settings
 * 書き込み画面はスレビューから全画面モーダルで開く。リンクからは開けない。
 */

import { useShareIntent } from 'expo-share-intent'
import React, { useEffect, useState } from 'react'
import {
  NavigationContainer,
  useNavigationContainerRef,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { StatusBar, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'

import Icon from 'components/Icon'
import { sharedUrl, shareTarget } from 'lib/shareTarget'
import Boards from 'scenes/boards/Boards'
import Home from 'scenes/home/Home'
import Post from 'scenes/post/Post'
import Search from 'scenes/search/Search'
import AccountSettings from 'scenes/settings/AccountSettings'
import FavoritesOrder from 'scenes/home/FavoritesOrder'
import HighlightSettings from 'scenes/settings/HighlightSettings'
import AiSettings from 'scenes/settings/AiSettings'
import ImageNgSettings from 'scenes/settings/ImageNgSettings'
import NgSettings from 'scenes/settings/NgSettings'
import UploadHistory from 'scenes/settings/UploadHistory'
import PostHistory from 'scenes/settings/PostHistory'
import Terms from 'scenes/settings/Terms'
import Settings from 'scenes/settings/Settings'
import Thread from 'scenes/thread/Thread'
import Threads from 'scenes/threads/Threads'
import { useEmberTheme } from 'theme/ember'

const Tab = createBottomTabNavigator()
const Stack = createStackNavigator()
const RootStack = createStackNavigator()

const linking = {
  prefixes: ['ember://'],
  config: {
    // リンクから起動しても、スレの下にタブを置いて戻れるようにする
    initialRouteName: 'Tabs',
    screens: {
      Tabs: {
        screens: {
          HomeTab: { screens: { Watch: 'home' } },
          BoardTab: {
            initialRouteName: 'Boards',
            screens: { Boards: 'boards', Threads: 'board' },
          },
          SearchTab: { screens: { SearchTop: 'search' } },
          SettingsTab: { screens: { SettingsTop: 'settings' } },
        },
      },
      Thread: 'thread',
    },
  },
}

/**
 * ヘッダーを外した画面の上端をステータスバーの下に揃える。
 * 上端の色は、画面の最上部がバーならバーの色に、そうでなければ背景色に合わせる。
 */
function belowStatusBar(Scene, { bar = false } = {}) {
  return function TabTopScene(props) {
    const theme = useEmberTheme()
    const insets = useSafeAreaInsets()
    return (
      <View
        style={{
          flex: 1,
          paddingTop: insets.top,
          backgroundColor: bar ? theme.surface : theme.bg,
        }}
      >
        <Scene {...props} />
      </View>
    )
  }
}

/**
 * スレが変わったら画面を作り直す。リンクや共有で別のスレを開くと同じ画面が
 * 使い回され、前のスレの本文が残ったまま新しいスレとして扱われてしまうため。
 */
function ThreadForUrl(props) {
  const { route } = props
  return <Thread key={route.params?.threadUrl} {...props} />
}

const HomeTop = belowStatusBar(Home)
const BoardsTop = belowStatusBar(Boards, { bar: true })
const SearchTop = belowStatusBar(Search, { bar: true })
const SettingsTop = belowStatusBar(Settings)
const NO_HEADER = { headerShown: false }

const tabIcon =
  (name) =>
  ({ color, size }) =>
    <Icon name={name} color={color} size={size} />

function stackScreens(theme) {
  return {
    headerStyle: { backgroundColor: theme.surface },
    headerTintColor: theme.text,
    headerTitleStyle: { fontSize: 16 },
    headerBackButtonDisplayMode: 'minimal',
    cardStyle: { backgroundColor: theme.bg },
  }
}

function HomeStack() {
  const theme = useEmberTheme()
  return (
    <Stack.Navigator screenOptions={stackScreens(theme)}>
      <Stack.Screen name="Watch" component={HomeTop} options={NO_HEADER} />
      <Stack.Screen
        name="FavoritesOrder"
        component={FavoritesOrder}
        options={{
          title: 'お気に入りの並べ替え',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
    </Stack.Navigator>
  )
}

function BoardStack() {
  const theme = useEmberTheme()
  return (
    <Stack.Navigator screenOptions={stackScreens(theme)}>
      <Stack.Screen name="Boards" component={BoardsTop} options={NO_HEADER} />
      <Stack.Screen
        name="Threads"
        component={Threads}
        options={{ headerBackAccessibilityLabel: '戻る' }}
      />
    </Stack.Navigator>
  )
}

function SearchStack() {
  const theme = useEmberTheme()
  return (
    <Stack.Navigator screenOptions={stackScreens(theme)}>
      <Stack.Screen
        name="SearchTop"
        component={SearchTop}
        options={NO_HEADER}
      />
    </Stack.Navigator>
  )
}

function SettingsStack() {
  const theme = useEmberTheme()
  return (
    <Stack.Navigator screenOptions={stackScreens(theme)}>
      <Stack.Screen
        name="SettingsTop"
        component={SettingsTop}
        options={NO_HEADER}
      />
      <Stack.Screen
        name="AccountSettings"
        component={AccountSettings}
        options={{
          title: 'アカウント',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
      <Stack.Screen
        name="PostHistory"
        component={PostHistory}
        options={{
          title: '書き込み履歴',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
      <Stack.Screen
        name="Terms"
        component={Terms}
        options={{
          title: '書き込みの利用条件',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
      <Stack.Screen
        name="NgSettings"
        component={NgSettings}
        options={{
          title: 'NG 管理',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
      <Stack.Screen
        name="AiSettings"
        component={AiSettings}
        options={{
          title: 'AI',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
      <Stack.Screen
        name="ImageNgSettings"
        component={ImageNgSettings}
        options={{
          title: '画像 NG',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
      <Stack.Screen
        name="UploadHistory"
        component={UploadHistory}
        options={{
          title: 'アップロード履歴',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
      <Stack.Screen
        name="HighlightSettings"
        component={HighlightSettings}
        options={{
          title: '強調表示',
          headerBackAccessibilityLabel: '戻る',
        }}
      />
    </Stack.Navigator>
  )
}

function Tabs() {
  const theme = useEmberTheme()
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textFaint,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
        },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStack}
        options={{ title: 'ホーム', tabBarIcon: tabIcon('home') }}
      />
      <Tab.Screen
        name="BoardTab"
        component={BoardStack}
        options={{ title: '板', tabBarIcon: tabIcon('boards') }}
      />
      <Tab.Screen
        name="SearchTab"
        component={SearchStack}
        options={{ title: '検索', tabBarIcon: tabIcon('search') }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{ title: '設定', tabBarIcon: tabIcon('settings') }}
      />
    </Tab.Navigator>
  )
}

export default function Navigation() {
  const theme = useEmberTheme()
  const navRef = useNavigationContainerRef()
  const [navReady, setNavReady] = useState(false)
  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntent()

  useEffect(() => {
    if (error) console.warn(`[share] 共有を受け取れない: ${error}`)
  }, [error])

  // 共有シートから来た 5ch の URL を開く（§6-3）
  useEffect(() => {
    if (!hasShareIntent || !navReady) return
    const target = shareTarget(sharedUrl(shareIntent))
    if (target) {
      navRef.navigate(target.name, target.params)
    } else {
      Toast.show({ type: 'info', text1: '5ch の URL ではありません' })
    }
    resetShareIntent()
  }, [hasShareIntent, shareIntent, navReady, navRef, resetShareIntent])

  const navTheme = {
    ...(theme.dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.dark ? DarkTheme : DefaultTheme).colors,
      background: theme.bg,
      card: theme.surface,
      text: theme.text,
      border: theme.border,
      primary: theme.accent,
    },
  }

  return (
    <>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <NavigationContainer
        ref={navRef}
        theme={navTheme}
        linking={linking}
        onReady={() => setNavReady(true)}
      >
        <RootStack.Navigator screenOptions={stackScreens(theme)}>
          <RootStack.Screen
            name="Tabs"
            component={Tabs}
            options={{ headerShown: false }}
          />
          <RootStack.Screen
            name="Thread"
            component={ThreadForUrl}
            options={{ headerBackAccessibilityLabel: '戻る' }}
          />
          <RootStack.Screen
            name="Post"
            component={Post}
            options={{
              presentation: 'modal',
              headerBackAccessibilityLabel: '閉じる',
            }}
          />
        </RootStack.Navigator>
      </NavigationContainer>
      <Toast />
    </>
  )
}
